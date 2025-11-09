import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import helmet from 'helmet';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { appConfig } from '../bootstrap/init-config.js';
import { AboutPageRenderer, getHealthStatus } from './about-renderer/about-renderer.js';
import { getResource, getResourcesList } from '../mcp/resources.js';
import { McpServerData } from '../types.js';

function getProjectData(): McpServerData {
  return (global as any).__MCP_PROJECT_DATA__;
}
import { authTokenMW } from '../token/token.js';
import { createMcpServer } from '../mcp/create-mcp-server.js';
import { logger as lgr } from '../logger.js';
import { createJsonRpcErrorResponse, ServerError, toError, toStr } from '../errors/errors.js';
import { BaseMcpError } from '../errors/BaseMcpError.js';
import { formatRateLimitError, isRateLimitError } from '../utils/rate-limit.js';
import { applyCors } from './cors.js';
import { faviconSvg } from './favicon-svg.js';
import chalk from 'chalk';
import { getPrompt, getPromptsList } from '../mcp/prompts.js';

const logger = lgr.getSubLogger({ name: chalk.bgYellow('server-http') });

function createAvailableEndpoints() {
  const { httpComponents } = getProjectData();
  const swagger = httpComponents?.swagger;
  const customEndpoints = httpComponents?.customEndpoints || {};

  const availableEndpoints: any = {
    about: 'GET /',
    health: 'GET /health',
    sse: 'GET /sse',
    mcp: 'POST /mcp',
  };

  if (swagger) {
    availableEndpoints.docs = 'GET /docs';
  }
  Object.assign(availableEndpoints, {
    ...customEndpoints,
  });

  return availableEndpoints;
}

const availableEndpoints = createAvailableEndpoints();

/**
 * Handle rate limiting with consistent error response
 */
async function handleRateLimit (
  rateLimiter: RateLimiterMemory,
  clientId: string,
  ip: string,
  context: string = '',
  res?: express.Response,
  id?: any,
): Promise<void> {
  try {
    await rateLimiter.consume(clientId);
  } catch (rateLimitError) {
    if (isRateLimitError(rateLimitError)) {
      const rateLimitMessage = formatRateLimitError(
        rateLimitError as any,
        appConfig.mcp.rateLimit.maxRequests,
      );
      logger.warn(`Rate limit exceeded${context ? ` in ${context}` : ''}: ip: ${ip}`);

      if (res) {
        res.status(200).json({
          jsonrpc: '2.0',
          id: id ?? 1,
          error: {
            code: -32000,
            message: rateLimitMessage,
          },
        });
        return;
      } else {
        throw new Error(rateLimitMessage);
      }
    }
    throw rateLimitError;
  }
}

/**
 * Start HTTP server with SSE transport
 */
export async function startHttpServer (): Promise<void> {
  const app = express();
  // Initialize rate limiter
  const rateLimiter = new RateLimiterMemory({
    keyPrefix: appConfig.shortName,
    points: appConfig.mcp.rateLimit.maxRequests,
    duration: appConfig.mcp.rateLimit.windowMs / 1000, // Convert to seconds
  });

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Allow for SSE
    crossOriginEmbedderPolicy: false,
  }));

  // JSON parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  applyCors(app);

  app.use(faviconSvg());

  const aboutPageRenderer = new AboutPageRenderer(appConfig);

  // Root endpoint with About page
  app.get('/', async (req, res) => {
    try {
      const html = await aboutPageRenderer.renderFullPage();
      res.type('html').send(html);
    } catch (error) {
      logger.error('Failed to render about page:', error);
      res.status(500).send('Error rendering about page');
    }
  });

  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      const health = await getHealthStatus();
      res.json(health);
    } catch (error) {
      logger.error('Health check failed:', error);
      res.status(500).json({
        status: 'unhealthy',
        error: 'Health check failed',
      });
    }
  });

  const { httpComponents } = getProjectData();
  const swagger = httpComponents?.swagger;
  const apiRouter = httpComponents?.apiRouter;

  if (swagger) {
    app.use('/docs', swagger.swaggerUi.serve, swagger.swaggerUi.setup(swagger.swaggerSpecs, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'MCP Staff Search API Documentation',
    }));
  }

  // API routes
  if (apiRouter) {
    app.use('/api', apiRouter);
  }

  // SSE endpoint for MCP communication
  app.get('/sse', authTokenMW, async (req, res) => {
    try {
      // Apply rate limiting for SSE connection
      const clientId = `sse-${req.ip || 'unknown'}`;
      await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'SSE', res, 1);

      logger.error('SSE client connected');

      // Create a separate server instance for this SSE connection with rate limiting
      const sseServer = createMcpServer();

      // Override the tool call handler to include rate limiting
      sseServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        // Apply rate limiting for each SSE tool call
        const toolCallClientId = `sse-tool-${req.ip || 'unknown'}`;
        await handleRateLimit(rateLimiter, toolCallClientId, req.ip || 'unknown', `SSE tool call | tool: ${request.params.name}`);

        // Execute the tool call
        const { toolHandler } = getProjectData();
        const result = await toolHandler(request.params);
        return {
          content: result.content,
        };
      });

      const transport = new SSEServerTransport('/sse', res);
      await sseServer.connect(transport);

      logger.error('SSE connection established successfully');
      return;
    } catch (error) {
      logger.error('SSE connection failed:', error);
      return res.status(500).json(createJsonRpcErrorResponse(
        new ServerError('Failed to establish SSE connection'),
      ));
    }
  });

  // POST endpoint for MCP requests
  app.post('/mcp', authTokenMW, async (req, res) => {
    try {
      // Apply rate limiting
      const clientId = req.ip || 'unknown';
      await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'HTTP MCP', res, req.body?.id);

      const { method, params, id } = req.body;

      logger.error(`HTTP MCP request received: ${method} | id: ${id}`);

      let result;

      switch (method) {
        case 'initialize':
          const { protocolVersion, capabilities: clientCapabilities, clientInfo } = params || {};
          logger.info(`MCP client initializing: protocolVersion: ${protocolVersion} | clientCapabilities: ${JSON.stringify(clientCapabilities)} | clientInfo: ${JSON.stringify(clientInfo)}`);
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              prompts: {},
              resources: {},
            },
            serverInfo: {
              name: appConfig.name,
              version: appConfig.version,
            },
          };
          break;

        case 'tools/list':
          const { tools } = getProjectData();
          result = { tools };
          break;

        case 'tools/call':
          // Apply rate limiting for tool calls
          const toolCallClientId = `tool-${req.ip || 'unknown'}`;
          await handleRateLimit(rateLimiter, toolCallClientId, req.ip || 'unknown', `tool call | tool: ${params?.name || 'unknown'}`, res, id);
          const { toolHandler } = getProjectData();
          result = await toolHandler(params);
          break;

        case 'prompts/list':
          result = getPromptsList();
          break;

        case 'prompts/get': {
          result = getPrompt(params.name);
          break;
        }

        case 'resources/list':
          result = getResourcesList();
          break;

        case 'resources/read': {
          result = getResource(params.uri);
          break;
        }

        case 'notifications/initialized':
          logger.error('MCP client initialization completed');
          return res.status(204).send();

        case 'ping':
          result = { pong: true };
          break;

        default:
          throw new Error(`Unknown method: ${method}`);
      }

      return res.json({
        jsonrpc: '2.0',
        id,
        result,
      });
    } catch (error: Error | any) {
      if (!error.printed) {
        logger.error('MCP request failed', toError(error));
        error.printed = true;
      }
      let errorResponse;
      if (error instanceof BaseMcpError) {
        // Use full error structure with details for better debugging
        const errorObj = error.toJSON();
        errorResponse = {
          code: -1,
          message: errorObj.message,
          data: {
            code: errorObj.code,
            details: errorObj.details,
            // stack: process.env.NODE_ENV === 'development' ? errorObj.stack : undefined
          },
        };
      } else {
        // Standard error handling for non-MCP errors
        errorResponse = {
          code: -1,
          message: toStr(error),
        };
      }
      return res.json({
        jsonrpc: '2.0',
        id: req.body?.id ?? 1,
        error: errorResponse,
      });
    }
  });

  // 404 handler for unknown routes
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.path}`,
      availableEndpoints,
    });
  });

  // Error handling middleware (must have 4 parameters for Express to recognize it)
  app.use((error: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Express error handler', error);

    if (!res.headersSent) {
      res.status(500).json(createJsonRpcErrorResponse(error));
    }
  });

  // Start HTTP server
  const port = appConfig.webServer.port;
  app.listen(port, '0.0.0.0', () => {
    const msg = `${appConfig.productName} started with HTTP transport on port ${port}
About page: http://localhost:${port}/`;
    console.log(msg);
  });
}
