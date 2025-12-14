import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import helmet from 'helmet';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { getResource, getResourcesList } from '../mcp/resources.js';
import { IGetPromptRequest } from '../_types_/types.js';

import { createAuthMW } from '../auth/middleware.js';
import { createMcpServer } from '../mcp/create-mcp-server.js';
import { logger as lgr } from '../logger.js';
import { createJsonRpcErrorResponse, ServerError, toError, toStr } from '../errors/errors.js';
import { BaseMcpError } from '../errors/BaseMcpError.js';
import { formatRateLimitError, isRateLimitError } from '../utils/rate-limit.js';
import { applyCors } from './cors.js';
import { faviconSvg } from './favicon-svg.js';
import chalk from 'chalk';
import { getPrompt, getPromptsList } from '../mcp/prompts.js';
import { handleAboutInfo } from './about-api.js';
import { getMainDBConnectionStatus } from '../db/pg-db.js';
import { normalizeHeaders } from '../utils/utils.js';
import { createAdminRouter } from './admin-router.js';
import { validateAdminAuthConfig } from '../auth/admin-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to static files
const staticPath = join(__dirname, 'static');

const logger = lgr.getSubLogger({ name: chalk.bgYellow('server-http') });

const { adminAuth } = appConfig.webServer || {};
export const isAdminEnabled = adminAuth?.enabled === true;

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

  // Create universal auth middleware for all endpoints
  const authMW = createAuthMW();

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

  // Serve static files (CSS, JS, SVG)
  app.use('/static', express.static(staticPath));

  // About page API endpoint
  app.get('/api/about-info', handleAboutInfo);

  // Root endpoint - serve static About page
  app.get('/', (req, res) => {
    res.sendFile(join(staticPath, 'about', 'index.html'));
  });

  // Health check endpoint
  app.get('/health', async (req, res) => {
    let health: any = {
      status: 'healthy',
      details: {
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
    };
    if (appConfig.isMainDBUsed) {
      health.details.dbConnectionStatus = await getMainDBConnectionStatus();
      if (health.details.dbConnectionStatus === 'error') {
        health.status = 'unhealthy';
      }
    }
    res.json(health);
  });

  const { httpComponents, tools, toolHandler } = getProjectData();
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

  // Admin panel routes (Token Generator & Validator)
  if (isAdminEnabled) {
    const adminConfigError = validateAdminAuthConfig();
    if (adminConfigError) {
      logger.error(`Admin auth configuration error: ${adminConfigError}`);
      throw new Error(`Admin auth configuration error: ${adminConfigError}`);
    }
    const adminRouter = createAdminRouter();
    app.use('/admin', adminRouter);
    logger.info('Admin panel mounted at /admin');
  }

  // SSE endpoints for legacy MCP communication
  // Store SSE transports by session ID with transport, server, and preserved headers
  const sseTransports = new Map<string, {
    transport: SSEServerTransport,
    server: any,
    headers: Record<string, string>
  }>();

  // Create SSE server instance with preserved headers from connection establishment
  async function createSseServer (preservedHeaders: Record<string, string>) {
    const sseServer = createMcpServer();

    // Override the tool call handler to include rate limiting and preserved headers
    sseServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      // Apply rate limiting for each SSE tool call
      const toolCallClientId = 'sse-tool-unknown';
      await handleRateLimit(rateLimiter, toolCallClientId, 'unknown', `SSE tool call | tool: ${request.params.name}`);

      // Execute the tool call with preserved headers from SSE connection establishment
      const result = await toolHandler({
        ...request.params,
        headers: preservedHeaders // Use headers from when SSE connection was established
      });
      return {
        content: result.content,
      };
    });

    return sseServer;
  }

  // GET endpoint for SSE connection establishment
  app.get('/sse', authMW, async (req, res) => {
    try {
      // Apply rate limiting for SSE connection
      const clientId = `sse-${req.ip || 'unknown'}`;
      await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'SSE', res, 1);

      logger.info('SSE client connected');

      // Preserve normalized headers from SSE connection establishment
      const preservedHeaders = normalizeHeaders(req.headers);
      logger.debug('SSE connection headers preserved:', Object.keys(preservedHeaders));

      // Create SSE transport that will use the same endpoint for POST requests
      const transport = new SSEServerTransport('/sse', res);

      // Create a dedicated server instance with preserved headers for this SSE connection
      const sseServer = await createSseServer(preservedHeaders);

      // Store transport, server, and headers for cleanup and reference
      sseTransports.set(transport.sessionId, {
        transport,
        server: sseServer,
        headers: preservedHeaders
      });

      // Clean up transport and server on connection close
      res.on('close', () => {
        sseTransports.delete(transport.sessionId);
        logger.info(`SSE client disconnected: ${transport.sessionId}`);
      });

      await sseServer.connect(transport);

      logger.info('SSE connection established successfully');
      return;
    } catch (error) {
      logger.error('SSE connection failed:', error);
      return res.status(500).json(createJsonRpcErrorResponse(
        new ServerError('Failed to establish SSE connection'),
      ));
    }
  });

  // POST endpoint for handling SSE client messages (standard way)
  app.post('/messages', authMW, async (req, res): Promise<void> => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: 'Session ID required',
          },
          id: null,
        });
        return;
      }

      const transportData = sseTransports.get(sessionId);
      if (!transportData) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Session not found',
          },
          id: null,
        });
        return;
      }

      const { transport } = transportData;
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      logger.error('SSE message handling failed', error);
      if (!res.headersSent) {
        res.status(500).json(createJsonRpcErrorResponse(
          new ServerError('Failed to handle SSE message'),
        ));
      }
    }
  });

  // POST endpoint for direct SSE requests (legacy compatibility - same endpoint as GET)
  app.post('/sse', authMW, async (req, res): Promise<void> => {
    try {
      // Find any active SSE transport for this client (fallback approach)
      // TODO: This is needed for test client compatibility. In production, clients should use proper session management or POST to /messages endpoint.
      let targetTransport = null;

      for (const [_sessionId, transportData] of sseTransports.entries()) {
        // Use the first available transport (simple approach for testing)
        targetTransport = transportData.transport;
        break;
      }

      if (!targetTransport) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'No SSE connection established. Connect via GET /sse first.',
          },
          id: req.body?.id ?? null,
        });
        return;
      }

      // Apply rate limiting
      const clientId = req.ip || 'unknown';
      await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'SSE POST', res, req.body?.id);

      logger.info(`Direct SSE POST request received: ${req.body.method} | id: ${req.body.id}`);

      // Use the transport's built-in handlePostMessage method
      await targetTransport.handlePostMessage(req, res, req.body);
    } catch (error) {
      logger.error('SSE POST request failed', error);
      if (!res.headersSent) {
        res.status(500).json(createJsonRpcErrorResponse(
          new ServerError('Failed to handle SSE POST request'),
        ));
      }
    }
  });

  // POST endpoint for MCP requests
  app.post('/mcp', authMW, async (req, res) => {
    try {
      // Apply rate limiting
      const clientId = req.ip || 'unknown';
      await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'HTTP MCP', res, req.body?.id);

      const request = req.body;
      const { method, params, id } = request;

      logger.info(`HTTP MCP request received: ${method} | id: ${id}`);

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
          result = { tools };
          break;

        case 'tools/call':
          // Apply rate limiting for tool calls
          const toolCallClientId = `tool-${req.ip || 'unknown'}`;
          await handleRateLimit(rateLimiter, toolCallClientId, req.ip || 'unknown', `tool call | tool: ${params?.name || 'unknown'}`, res, id);
          result = await toolHandler({
            ...params,
            headers: normalizeHeaders(req.headers)
          });
          break;

        case 'prompts/list':
          result = getPromptsList();
          break;

        case 'prompts/get': {
          result = await getPrompt(request as IGetPromptRequest);
          break;
        }

        case 'resources/list':
          result = getResourcesList();
          break;

        case 'resources/read': {
          result = await getResource(params.uri);
          break;
        }

        case 'notifications/initialized':
          logger.info('MCP client initialization completed');
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
    const availableEndpoints: any = {
      about: 'GET /',
      health: 'GET /health',
      sse: 'GET /sse, POST /sse',
      messages: 'POST /messages',
      mcp: 'POST /mcp',
    };

    if (swagger) {
      availableEndpoints.docs = 'GET /docs';
    }
    if (isAdminEnabled) {
      availableEndpoints.admin = 'GET /admin';
    }
    Object.assign(availableEndpoints, {
      ...(httpComponents?.endpointsOn404 || {}),
    });

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
    let msg = `${chalk.magenta(appConfig.productName)} started with ${chalk.blue('HTTP')} transport on port ${chalk.blue(port)}
About page: http://localhost:${port}/`;
    if (isAdminEnabled) {
      msg += `\nAdmin panel: http://localhost:${port}/admin`;
    }
    console.log(msg);
  });
}
