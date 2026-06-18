import { randomUUID } from 'node:crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { InMemoryEventStore } from './event-store.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import chalk from 'chalk';
import express from 'express';
import helmet from 'helmet';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import { IClientCapabilities } from '../_types_/types.js';
import { createAgentTesterRouter } from '../agent-tester/agent-tester-router.js';
import { validateAdminAuthConfig } from '../auth/admin-auth.js';
import { createAgentTesterSessionMW } from '../auth/agent-tester-auth.js';
import { checkJwtToken, generateToken, MIN_ENCRYPT_KEY_LENGTH } from '../auth/jwt.js';
import { canLocallyIssueJwt, getJwtRuntimeConfig } from '../auth/key-resolver.js';
import { createAuthMW } from '../auth/middleware.js';
import { checkPermanentToken } from '../auth/permanent.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { getMainDBConnectionStatus } from '../db/pg-db.js';
import { createJsonRpcErrorResponse, ServerError, toError, toStr } from '../errors/errors.js';
import {
  PayloadTooLargeError,
  RateLimitedError,
  ResourceNotFoundError,
  TimeoutError,
} from '../errors/specific-errors.js';
import { logger as lgr } from '../logger.js';
import { getMetrics, getMetricsRegistry, initMetrics } from '../metrics/metrics.js';
import { createMcpServer } from '../mcp/create-mcp-server.js';
import { getPromptsList } from '../mcp/prompts.js';
import { getResource, getResourcesList } from '../mcp/resources.js';
import { truncateToolResponse, withToolTimeout } from '../mcp/tool-limits.js';
import { formatRateLimitError, isRateLimitError } from '../utils/rate-limit.js';
import { getTools, normalizeHeaders } from '../utils/utils.js';

import { createAdminRouter } from './admin-router.js';
import { applyCors } from './cors.js';
import { faviconSvg } from './favicon-svg.js';
import { handleHomeInfo } from './home-api.js';
import { createOAuthRouter } from './oauth-router.js';
import { configureOpenAPI, createSwaggerUIAssetsMiddleware } from './openapi.js';
import { requestIdMW } from './request-id.js';
import { createSvgRouter } from './svg-icons.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to static files
const staticPath = join(__dirname, 'static');

const logger = lgr.getSubLogger({ name: chalk.bgYellow('server-http') });

export const isAdminEnabled = appConfig.adminPanel?.enabled === true;

/**
 * Standard §14 — pick the rate-limit bucket key from the request:
 *   - `scope: 'subject'` → JWT `sub`/`user` claim, falling back to req.ip when no auth payload
 *   - `scope: 'ip'`      → req.ip / unknown
 */
function resolveRateLimitKey(req: express.Request, suffix: string = ''): string {
  const scope = appConfig.mcp.rateLimit?.scope ?? 'subject';
  let key = '';
  if (scope === 'subject') {
    const payload = (req as any).auth?.payload ?? (req as any).authInfo?.payload;
    const sub: string | undefined = payload?.sub ?? payload?.user ?? (req as any).authInfo?.username;
    if (sub && String(sub).trim()) {
      key = `sub:${String(sub).trim().toLowerCase()}`;
    }
  }
  if (!key) {
    key = `ip:${req.ip || 'unknown'}`;
  }
  return suffix ? `${suffix}-${key}` : key;
}

/**
 * Handle rate limiting with consistent error response
 */
async function handleRateLimit(
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
      const rateLimitMessage = formatRateLimitError(rateLimitError as any, appConfig.mcp.rateLimit.maxRequests);
      logger.warn(`Rate limit exceeded${context ? ` in ${context}` : ''}: ip: ${ip}`);

      const scope = (appConfig.mcp.rateLimit?.scope ?? 'subject') as 'subject' | 'ip';
      getMetrics()?.rateLimitHits.inc({ scope });

      // Standard §14 + Appendix B: HTTP 429, JSON-RPC code -32003, `Retry-After` header in
      // seconds (also mirrored under `error.data.retryAfter` per Appendix B.3).
      const retryAfterSec = Math.max(1, Math.ceil(((rateLimitError as any).msBeforeNext ?? 1000) / 1000));
      const error = new RateLimitedError(rateLimitMessage, retryAfterSec);

      if (res) {
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(error.statusCode).json(createJsonRpcErrorResponse(error, id ?? null));
        return;
      } else {
        throw error;
      }
    }
    throw rateLimitError;
  }
}

/**
 * Start HTTP server with SSE transport
 */
export async function startHttpServer(): Promise<void> {
  const app = express();
  // Express `trust proxy`. Required for /.well-known/openid-configuration when the server
  // sits behind HTTPS reverse proxy (X-Forwarded-Proto / X-Forwarded-Host).
  if (appConfig.webServer.trustProxy !== undefined) {
    app.set('trust proxy', appConfig.webServer.trustProxy);
  }
  // Initialize rate limiter
  const rateLimiter = new RateLimiterMemory({
    keyPrefix: appConfig.shortName,
    points: appConfig.mcp.rateLimit.maxRequests,
    duration: appConfig.mcp.rateLimit.windowMs / 1000, // Convert to seconds
  });

  // Create universal auth middleware for all endpoints
  const authMW = createAuthMW();

  // Standard §15.1 — sticky `X-Request-Id` (+ W3C traceparent/tracestate) MUST be installed
  // before CORS, auth or any handler that may shortcut the chain — otherwise 401/403
  // responses would land without a correlation id, breaking downstream debugging.
  app.use(requestIdMW());

  // Standard §15.3 — Prometheus metrics. Opt-in: enabled flag drives both `prom-client`
  // registry initialisation and `GET /metrics` mounting below.
  const metricsCfg = appConfig.webServer.metrics;
  const metricsEnabled = metricsCfg?.enabled === true;
  if (metricsEnabled) {
    initMetrics();
  }

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allow for SSE
      crossOriginEmbedderPolicy: false,
    }),
  );

  // JSON parsing. Body size is capped by `mcp.limits.maxPayloadBytes` (standard §14, default 1 MiB).
  // Anything above is intercepted by the error-handling middleware below and converted to
  // a JSON-RPC `-32005` / HTTP 413 response.
  const { maxPayloadBytes } = appConfig.mcp.limits;
  app.use(express.json({ limit: maxPayloadBytes }));
  app.use(express.urlencoded({ extended: true, limit: maxPayloadBytes }));

  applyCors(app);

  // OAuth discovery + token endpoints (mounted before auth MW so they remain public).
  // Active only when jwtToken.mode !== 'legacyAesCtr'.
  if (getJwtRuntimeConfig().mode !== 'legacyAesCtr') {
    app.use(createOAuthRouter());
  }

  app.use(faviconSvg());

  // Serve static files (CSS, JS, SVG)
  app.use('/static', express.static(staticPath));

  // SVG icons with color substitution
  app.use('/svg', createSvgRouter());

  // Home page API endpoint
  app.get('/api/home-info', handleHomeInfo);

  // Root endpoint - serve static Home page
  app.get('/', (req, res) => {
    res.sendFile(join(staticPath, 'home', 'index.html'));
  });

  // Health check endpoint. Standard §16.1 mandates `status`, `version` and `uptime`. An
  // `unhealthy` body is paired with HTTP 503 so platform health probes pick up the failure.
  app.get('/health', async (req, res) => {
    let health: any = {
      status: 'healthy',
      version: appConfig.version,
      uptime: process.uptime(),
      details: {
        timestamp: new Date().toISOString(),
      },
    };
    if (appConfig.isMainDBUsed) {
      health.details.dbConnectionStatus = await getMainDBConnectionStatus();
      if (health.details.dbConnectionStatus === 'error') {
        health.status = 'unhealthy';
      }
    }
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  });

  // Standard §15.3 — Prometheus metrics endpoint. Opt-in (default off). Public by design —
  // protect via network policy / reverse proxy if the server is reachable from the network.
  if (metricsEnabled) {
    const metricsPath = metricsCfg?.path || '/metrics';
    app.get(metricsPath, async (_req, res) => {
      try {
        const reg = getMetricsRegistry();
        res.setHeader('Content-Type', reg.contentType);
        res.end(await reg.metrics());
      } catch (err) {
        logger.error('Failed to render Prometheus metrics', err as Error);
        res.status(500).send('Failed to render metrics');
      }
    });
  }

  // Readiness probe (standard §16.2) — no authentication; reports whether every dependency
  // the server needs to serve traffic is up. Empty / sensitive details are NEVER returned —
  // each check is reduced to `ok` / `error`.
  app.get('/ready', async (req, res) => {
    const checks: Record<string, 'ok' | 'error' | 'skipped'> = {};
    let ready = true;

    if (appConfig.isMainDBUsed) {
      const dbStatus = await getMainDBConnectionStatus();
      if (dbStatus === 'connected') {
        checks.db = 'ok';
      } else {
        checks.db = 'error';
        ready = false;
      }
    }

    // Cache singleton: trivially available; surface it for diagnostic completeness.
    checks.cache = 'ok';

    // JWKS check is a placeholder until Phase 5 introduces the OAuth profile.
    checks.jwks = 'skipped';

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      checks,
    });
  });

  // Token check endpoint: POST /ct {"t": "<token>"}. Standard §7.1 forbids secrets in URL.
  // GET /ct?t=<token> is gated behind webServer.tokenCheck.allowQueryToken (non-prod only).
  const handleTokenCheck = async (req: express.Request, res: express.Response) => {
    const raw = req.method === 'GET' ? req.query.t : req.body?.t;
    const token = typeof raw === 'string' ? raw.trim() : '';
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token not provided. Pass via "t" body parameter' });
    }

    const { errorReason: permError } = checkPermanentToken(token);
    if (!permError) {
      return res.json({ success: true, type: 'permanent' });
    }

    const xff = req.headers['x-forwarded-for'];
    const xffStr = (Array.isArray(xff) ? (xff[0] ?? '') : (xff ?? '')).split(',').shift() ?? '';
    const clientIp = req.ip ?? (xffStr.trim() || (req.socket?.remoteAddress ?? ''));
    const jwtResult = await checkJwtToken({ token, clientIp });
    if (!jwtResult.errorReason) {
      return res.json({ success: true, type: 'JWT', payload: jwtResult.payload });
    }

    return res.status(401).json({ success: false, error: jwtResult.errorReason });
  };
  const allowQueryToken =
    appConfig.webServer.tokenCheck?.allowQueryToken === true && process.env.NODE_ENV !== 'production';
  if (allowQueryToken) {
    app.get('/ct', handleTokenCheck);
  } else {
    app.get('/ct', (_req, res) =>
      res.status(405).json({
        error: 'GET /ct is disabled by standard §7.1. Use POST /ct with JSON body {"t": "<token>"}.',
      }),
    );
  }
  app.post('/ct', handleTokenCheck);

  // Public endpoint: returns used HTTP headers configured in the template (optional)
  app.get('/used-http-headers', (req, res) => {
    try {
      const { usedHttpHeaders } = getProjectData();
      res.json(usedHttpHeaders || []);
    } catch (_e) {
      // If fetching project data fails for any reason, return empty list
      res.json([]);
    }
  });

  const { httpComponents } = getProjectData();
  const apiRouter = httpComponents?.apiRouter;

  // Auto-configure OpenAPI documentation if apiRouter is provided
  const openAPIConfig = apiRouter ? await configureOpenAPI(apiRouter) : null;

  // API routes
  if (apiRouter) {
    app.use('/api', apiRouter);

    // Serve Swagger UI assets if OpenAPI is configured
    if (openAPIConfig) {
      app.use('/docs', createSwaggerUIAssetsMiddleware(), openAPIConfig.swaggerUi);
    }
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
  }

  // JWT generation API endpoint
  if (appConfig.webServer.genJwtApiEnable) {
    const jwtMode = getJwtRuntimeConfig().mode;
    const encryptKey = appConfig.webServer.auth?.jwtToken?.encryptKey;
    const legacyKeyMissing =
      jwtMode === 'legacyAesCtr' && (!encryptKey || encryptKey.length < MIN_ENCRYPT_KEY_LENGTH || encryptKey === '***');

    if (legacyKeyMissing) {
      logger.error('genJwtApiEnable is true but webServer.auth.jwtToken.encryptKey is not configured');
    } else if (jwtMode === 'remoteJwks') {
      app.post('/gen-jwt', authMW, (_req: express.Request, res: express.Response) => {
        const { jwksUri } = getJwtRuntimeConfig();
        res.status(501).json({
          success: false,
          error: 'cannot_issue_token',
          error_description:
            'This server runs in mode=remoteJwks and does not issue JWTs. ' +
            (jwksUri ? `Obtain tokens from the IdP at ${jwksUri}.` : 'Obtain tokens from the configured IdP.'),
        });
      });
    } else {
      const TTL_MULTIPLIERS: Record<string, number> = { s: 1, m: 60, d: 86400, y: 31536000 };

      app.post('/gen-jwt', authMW, async (req: express.Request, res: express.Response) => {
        try {
          const { username, ttl, service, params } = req.body as {
            username?: string;
            ttl?: string;
            service?: string;
            params?: string | Record<string, string>;
          };

          if (!username || !username.trim()) {
            return res.status(400).json({ success: false, error: 'username is required' });
          }

          if (!ttl || !ttl.trim()) {
            return res
              .status(400)
              .json({ success: false, error: 'ttl is required. Format: <N>s | <N>m | <N>d | <N>y' });
          }

          const ttlMatch = /^(\d+)([smdy])$/.exec(ttl.trim());
          if (!ttlMatch) {
            return res
              .status(400)
              .json({ success: false, error: `Invalid ttl format "${ttl}". Expected: <N>s | <N>m | <N>d | <N>y` });
          }

          const ttlValue = parseInt(ttlMatch[1]!, 10);
          const ttlUnit = ttlMatch[2]!;
          if (ttlValue <= 0) {
            return res.status(400).json({ success: false, error: 'ttl value must be greater than 0' });
          }

          const liveTimeSec = ttlValue * TTL_MULTIPLIERS[ttlUnit]!;

          // Build payload
          const payload: Record<string, any> = {};
          if (service && service.trim()) {
            payload.service = service.trim();
          }

          // Parse params — string "key=value;key=value" or object
          if (params) {
            if (typeof params === 'string') {
              for (const pair of params.split(';')) {
                const eqIdx = pair.indexOf('=');
                if (eqIdx > 0) {
                  const key = pair.substring(0, eqIdx).trim();
                  const value = pair.substring(eqIdx + 1).trim();
                  if (key) {
                    payload[key] = value;
                  }
                }
              }
            } else if (typeof params === 'object') {
              Object.assign(payload, params);
            }
          }

          if (jwtMode !== 'legacyAesCtr' && !canLocallyIssueJwt()) {
            return res.status(501).json({
              success: false,
              error: 'cannot_issue_token',
              error_description: `Current jwtToken.mode=${jwtMode} cannot sign tokens locally.`,
            });
          }

          const token = await generateToken(username.trim(), liveTimeSec, payload);
          const expire = Date.now() + liveTimeSec * 1000;

          return res.json({
            success: true,
            token,
            user: username.trim().toLowerCase(),
            expire: new Date(expire).toISOString(),
            ttlSeconds: liveTimeSec,
          });
        } catch (error: any) {
          logger.error('Error generating JWT token:', error);
          return res.status(500).json({ success: false, error: error.message });
        }
      });
    }
  }

  const at = appConfig.agentTester;
  // Agent Tester routes
  if (at?.enabled) {
    const sessionMWs = createAgentTesterSessionMW();
    const agentTesterRouter = createAgentTesterRouter({
      defaultMcpUrl: `http://localhost:${appConfig.webServer.port}/mcp`,
      ...(at.openAi ? { openAi: at.openAi } : {}),
    });
    if (at.useAuth) {
      // sessionMWs handles: public paths → pass; valid session → set authInfo;
      // otherwise delegates internally to authMW (Authorization header / headless).
      app.use('/agent-tester', ...sessionMWs, agentTesterRouter);
    } else {
      app.use('/agent-tester', agentTesterRouter);
    }
  } else {
    app.use('/agent-tester', (_req: express.Request, res: express.Response) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  // SSE endpoints for legacy MCP communication
  // Store SSE transports by session ID with transport, server, preserved headers, and auth payload
  const sseTransports = new Map<
    string,
    {
      transport: SSEServerTransport;
      server: any;
      headers: Record<string, string>;
      payload?: { user: string; [key: string]: any };
    }
  >();

  // Create SSE server instance with preserved headers and auth payload from connection establishment.
  // Client capabilities are read lazily on every call via `sseServer.getClientCapabilities()` so the
  // value reflects the post-handshake state for every list/read/call.
  async function createSseServer(
    preservedHeaders: Record<string, string>,
    mcpAuthPayload?: { user: string; [key: string]: any },
  ) {
    const sseServer = createMcpServer('sse');

    const sseCtx = () => {
      const caps = sseServer.getClientCapabilities() as IClientCapabilities | undefined;
      return {
        transport: 'sse' as const,
        headers: preservedHeaders,
        payload: mcpAuthPayload,
        ...(caps ? { clientCapabilities: caps } : {}),
      };
    };

    // Override tools/list to pass correct transport and context
    sseServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await getTools(sseCtx());
      return { tools };
    });

    // Override prompts/list to pass correct transport and context
    sseServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      return await getPromptsList(sseCtx());
    });

    // Override resources/list to pass correct transport and context
    sseServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      return await getResourcesList(sseCtx());
    });

    // Override resources/read to pass correct transport and context
    sseServer.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
      return (await getResource(request.params.uri, sseCtx())) as any;
    });

    // Override the tool call handler to include rate limiting, preserved headers and auth payload
    sseServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      // Apply rate limiting for each SSE tool call
      const toolCallClientId = 'sse-tool-unknown';
      await handleRateLimit(rateLimiter, toolCallClientId, 'unknown', `SSE tool call | tool: ${request.params.name}`);

      // Execute the tool call with preserved headers and payload from SSE connection establishment.
      // Same `mcp.limits` enforcement as the Streamable HTTP path.
      const { toolHandler } = getProjectData();
      const sseToolName = (request.params as any)?.name ?? 'unknown';
      const response = (await withToolTimeout(
        sseToolName,
        () =>
          toolHandler({
            ...request.params,
            ...sseCtx(),
            signal: extra?.signal,
          }) as Promise<any>,
      )) as any;
      return truncateToolResponse(response) as any;
    });

    return sseServer;
  }

  // GET endpoint for SSE connection establishment
  app.get('/sse', authMW, async (req, res) => {
    try {
      // Apply rate limiting for SSE connection
      const clientId = resolveRateLimitKey(req, 'sse');
      await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'SSE', res, 1);

      logger.info('SSE client connected');

      // Preserve normalized headers from SSE connection establishment
      const preservedHeaders = normalizeHeaders(req.headers);
      logger.debug('SSE connection headers preserved:', Object.keys(preservedHeaders));

      // Extract auth payload from middleware (set by authMW)
      const { authInfo } = req as any;
      const authPayload = authInfo?.payload;

      // Create SSE transport that will use the same endpoint for POST requests
      const transport = new SSEServerTransport('/sse', res);

      // Create a dedicated server instance with preserved headers and auth payload for this SSE connection
      const sseServer = await createSseServer(preservedHeaders, authPayload);

      // Store transport, server, headers, and payload for cleanup and reference
      sseTransports.set(transport.sessionId, {
        transport,
        server: sseServer,
        headers: preservedHeaders,
        payload: authPayload,
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
      return res.status(500).json(createJsonRpcErrorResponse(new ServerError('Failed to establish SSE connection')));
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
        const err = new ResourceNotFoundError('SSE session not found');
        res.status(err.statusCode).json(createJsonRpcErrorResponse(err, null));
        return;
      }

      const { transport } = transportData;
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      logger.error('SSE message handling failed', error);
      if (!res.headersSent) {
        res.status(500).json(createJsonRpcErrorResponse(new ServerError('Failed to handle SSE message')));
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
        const err = new ResourceNotFoundError('No SSE connection established. Connect via GET /sse first.');
        res.status(err.statusCode).json(createJsonRpcErrorResponse(err, req.body?.id ?? null));
        return;
      }

      // Apply rate limiting
      const clientId = resolveRateLimitKey(req);
      await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'SSE POST', res, req.body?.id);

      logger.info(`Direct SSE POST request received: ${req.body.method} | id: ${req.body.id}`);

      // Use the transport's built-in handlePostMessage method
      await targetTransport.handlePostMessage(req, res, req.body);
    } catch (error) {
      logger.error('SSE POST request failed', error);
      if (!res.headersSent) {
        res.status(500).json(createJsonRpcErrorResponse(new ServerError('Failed to handle SSE POST request')));
      }
    }
  });

  // Streamable HTTP runs **stateful**: each MCP session owns a `StreamableHTTPServerTransport`
  // bound to its own `Server` instance (so `getClientCapabilities()` works like on stdio). The
  // transport is created on `initialize`, keyed by the server-generated `Mcp-Session-Id`, and the
  // SDK transport handles protocol-version negotiation, error codes, notifications (202) and the
  // GET-SSE / DELETE-teardown semantics for us.
  const HTTP_SESSION_HEADER = 'mcp-session-id';
  // Verbose connection/handshake tracing. Per-request dumps (method, headers, session routing)
  // are gated behind `DEBUG=mcp-handshake` so they don't flood logs on every tool call; the
  // key lifecycle events (initialize, session created/closed, no-session rejection) always log.
  const debugNamespaces = (process.env.DEBUG || '').split(',').map((d) => d.trim());
  const HANDSHAKE_DEBUG = debugNamespaces.includes('mcp-handshake');
  // Separate namespace for successful RPC response summaries (`result=ok`), kept apart from the
  // connection/handshake trace so each can be enabled independently. Errors always log regardless.
  const RPC_DEBUG = debugNamespaces.includes('mcp-rpc');
  // Short session id for log lines (full UUID is noisy). Empty header → 'none'.
  const shortSid = (sid?: string): string => (sid ? sid.slice(0, 8) : 'none');
  // Summarize the request line for handshake tracing: JSON-RPC method, id, session header,
  // and presence of the headers that matter for the MCP transport contract.
  const describeMcpRequest = (req: express.Request): string => {
    const body = req.body as any;
    const h = req.headers;
    const hasAuth = !!(h.authorization || h['x-on-behalf-of-user']);
    return [
      `method=${body?.method ?? '(none)'}`,
      `id=${body?.id ?? '(none)'}`,
      `session=${shortSid(h[HTTP_SESSION_HEADER] as string | undefined)}`,
      `protocolVersion=${(h['mcp-protocol-version'] as string) || body?.params?.protocolVersion || '(none)'}`,
      `accept=${(h.accept as string) || '(none)'}`,
      `contentType=${(h['content-type'] as string) || '(none)'}`,
      `auth=${hasAuth ? 'yes' : 'no'}`,
      `ip=${req.ip || 'unknown'}`,
    ].join(' | ');
  };
  // Parse outgoing MCP payloads into JSON-RPC message objects. The SDK transport answers either
  // as plain JSON (`application/json`) or as an SSE stream (`text/event-stream`), where each frame
  // carries the JSON in a `data:` line. We auto-detect the shape FROM THE BODY rather than the
  // Content-Type header: by the time the response `finish`es, Node has already cleared the outgoing
  // headers, so `res.getHeader('content-type')` returns undefined at that point.
  const parseRpcMessages = (raw: string): any[] => {
    const out: any[] = [];
    const tryPush = (s: string) => {
      const t = s.trim();
      if (!t) {
        return;
      }
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) {
          out.push(...parsed);
        } else {
          out.push(parsed);
        }
      } catch {
        /* not JSON — ignore */
      }
    };
    // Plain-JSON answer: the whole body parses as one object/array.
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      tryPush(raw);
      if (out.length > 0) {
        return out;
      }
    }
    // SSE answer: collect every `data:` frame line.
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) {
        tryPush(line.slice(5));
      }
    }
    return out;
  };

  // Tee the response stream so we can log what is actually sent back — in particular every
  // JSON-RPC error (code + message + data), to verify the error message is meaningful. Errors
  // are logged ALWAYS; successful results are summarized only under `DEBUG=mcp-rpc` to avoid
  // dumping large tool payloads. Capture is capped to bound memory on long SSE streams.
  const installRpcResponseTrace = (req: express.Request, res: express.Response): void => {
    const MAX_CAPTURE = 256 * 1024;
    const chunks: Buffer[] = [];
    let captured = 0;
    let truncated = false;
    const collect = (chunk: any) => {
      if (!chunk || captured >= MAX_CAPTURE) {
        if (chunk && captured >= MAX_CAPTURE) {
          truncated = true;
        }
        return;
      }
      // The SDK transport writes `Uint8Array` (SSE) or strings; `Buffer.isBuffer` is false for a
      // Uint8Array, so we must NOT fall back to `String(chunk)` (that yields a comma-joined list of
      // byte codes). `Buffer.from` accepts Buffer, string, and Uint8Array/ArrayBuffer views directly.
      let buf: Buffer;
      if (Buffer.isBuffer(chunk)) {
        buf = chunk;
      } else if (typeof chunk === 'string') {
        buf = Buffer.from(chunk);
      } else {
        buf = Buffer.from(chunk);
      }
      chunks.push(buf);
      captured += buf.length;
    };
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    // Cast to any: the write/end overloads are complex; we only tee the first (chunk) argument.
    (res as any).write = (chunk: any, ...args: any[]) => {
      collect(chunk);
      return (origWrite as any)(chunk, ...args);
    };
    (res as any).end = (chunk: any, ...args: any[]) => {
      collect(chunk);
      return (origEnd as any)(chunk, ...args);
    };
    res.on('finish', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) {
          return;
        }
        const messages = parseRpcMessages(raw);
        const errors = messages.filter((m) => m && m.error);
        if (errors.length > 0) {
          for (const m of errors) {
            const data = m.error.data === undefined ? '' : ` | data=${JSON.stringify(m.error.data).slice(0, 800)}`;
            logger.warn(
              `MCP RPC error response → HTTP ${res.statusCode} | id=${m.id ?? '(none)'} | ` +
                `code=${m.error.code} | message=${JSON.stringify(m.error.message)}${data} ` +
                `| for: ${describeMcpRequest(req)}`,
            );
          }
        } else if (RPC_DEBUG) {
          const summary = messages
            .map((m) =>
              m.error
                ? `error ${m.error.code}`
                : m.result !== undefined
                  ? `id=${m.id} result=ok`
                  : m.method
                    ? `notif ${m.method}`
                    : `id=${m.id ?? '(none)'}`,
            )
            .join('; ');
          logger.info(
            `MCP RPC response → HTTP ${res.statusCode} | ${summary || `${raw.length} bytes`}` +
              (truncated ? ' | [capture truncated]' : ''),
          );
        }
      } catch {
        /* never let trace logging break the response */
      }
    });
  };

  // Soft cap to bound memory; oldest session is evicted (FIFO via Map insertion order).
  const MAX_HTTP_SESSIONS = 4096;
  const mcpTransports = new Map<string, StreamableHTTPServerTransport>();
  // Standard §6 (MAY) — SSE resumability. A single in-memory EventStore is shared across sessions
  // (each stream owns its own streamId). Created only when opted in; otherwise the transport is
  // built without an eventStore and behavior is unchanged.
  const sseResumability = appConfig.mcp.sse?.resumability === true;
  const sseEventStore = sseResumability
    ? new InMemoryEventStore(appConfig.mcp.sse?.maxStoredEvents ?? 1000)
    : undefined;
  if (sseResumability) {
    logger.info(`MCP SSE resumability enabled (in-memory, max ${appConfig.mcp.sse?.maxStoredEvents ?? 1000} events)`);
  }
  const evictOldestSession = (keep: string) => {
    while (mcpTransports.size > MAX_HTTP_SESSIONS) {
      const oldest = mcpTransports.keys().next().value;
      if (!oldest || oldest === keep) {
        break;
      }
      const t = mcpTransports.get(oldest);
      mcpTransports.delete(oldest);
      void t?.close();
    }
  };

  // Race the underlying transport against `mcp.limits.toolTimeoutMs` for `tools/call` requests.
  // The standard (§14) requires HTTP 504 + JSON-RPC -32004 on timeout. The SDK's transport
  // doesn't surface HTTP-level timeouts, so we monitor at this layer — whoever writes the
  // response first wins. The tool promise itself is still bounded inside the SDK handler by
  // `withToolTimeout`, which throws an `McpError(-32004)` to keep the JSON-RPC code correct
  // for the SSE branch and for the (unlikely) case the handler beats the HTTP timer.
  const runHttpToolCall = async (
    req: express.Request,
    res: express.Response,
    exec: () => Promise<void>,
  ): Promise<void> => {
    if ((req.body as any)?.method !== 'tools/call') {
      await exec();
      return;
    }
    const timeoutMs = appConfig.mcp.limits.toolTimeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const timerPromise = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      if (typeof timer?.unref === 'function') {
        timer.unref();
      }
    });
    try {
      const winner = await Promise.race([exec().then(() => 'done' as const), timerPromise]);
      if (winner === 'timeout' && !res.headersSent) {
        const toolName = (req.body as any)?.params?.name ?? 'unknown';
        const err = new TimeoutError(`Tool '${toolName}' exceeded ${timeoutMs} ms timeout`, {
          reason: 'tool_timeout',
        });
        logger.warn(`Tool timeout (${timeoutMs} ms) for tool: ${toolName}`);
        res.status(err.statusCode).json(createJsonRpcErrorResponse(err, (req.body as any)?.id ?? null));
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };

  // Read-only catalog methods served statelessly (no session). The list methods power the home-page
  // catalog; `resources/read` and `prompts/get` power "view content" on the same page — without them
  // here, clicking a resource/prompt in the UI fails with -32600 because the browser holds no session.
  const SESSIONLESS_CATALOG_METHODS = new Set([
    'tools/list',
    'prompts/list',
    'prompts/get',
    'resources/list',
    'resources/read',
  ]);

  const isSessionlessListRequest = (body: unknown): boolean => {
    const messages = Array.isArray(body) ? body : [body];
    return (
      messages.length > 0 &&
      messages.every((message) => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          return false;
        }
        const rpc = message as { id?: unknown; method?: unknown };
        return (
          Object.hasOwn(rpc, 'id') && typeof rpc.method === 'string' && SESSIONLESS_CATALOG_METHODS.has(rpc.method)
        );
      })
    );
  };

  const handleSessionlessListRequest = async (req: express.Request, res: express.Response): Promise<void> => {
    if (HANDSHAKE_DEBUG) {
      logger.info(`POST /mcp handling sessionless list request: ${describeMcpRequest(req)}`);
    }

    // Omit `sessionIdGenerator` to use the MCP SDK's stateless Streamable HTTP mode for this
    // one-off catalog request. Stateful sessions are still created only by `initialize`.
    const transport = new StreamableHTTPServerTransport();
    const server = createMcpServer('http');
    await server.connect(transport as any);
    try {
      await transport.handleRequest(req, res, req.body);
    } finally {
      await transport.close();
    }
  };

  const noSessionError = (req: express.Request, res: express.Response) => {
    // Always log: this path is otherwise silent, which is exactly why "-32600" appears on the
    // client with nothing on the server. We surface why the session was rejected.
    const sessionHeader = req.headers[HTTP_SESSION_HEADER] as string | undefined;
    logger.warn(
      `MCP rejected with -32600 (no valid session). The client must send an \`initialize\` request first, ` +
        `or include a valid \`mcp-session-id\` header. Request: ${describeMcpRequest(req)}` +
        (sessionHeader && !mcpTransports.get(sessionHeader)
          ? ` — session id ${shortSid(sessionHeader)} is unknown/expired (known sessions: ${mcpTransports.size})`
          : ''),
    );
    res.status(400).json({
      jsonrpc: '2.0',
      id: (req.body as any)?.id ?? null,
      error: { code: -32600, message: 'No valid MCP session. Send `initialize` first.' },
    });
  };

  // GET (server→client SSE stream) and DELETE (session teardown) operate on an existing session.
  const routeToSession = async (req: express.Request, res: express.Response): Promise<void> => {
    installRpcResponseTrace(req, res);
    const sessionId = req.headers[HTTP_SESSION_HEADER] as string | undefined;
    const transport = sessionId ? mcpTransports.get(sessionId) : undefined;
    if (HANDSHAKE_DEBUG) {
      logger.info(
        `MCP ${req.method} /mcp routing to session ${shortSid(sessionId)}: ` +
          `${transport ? 'found' : 'NOT FOUND'} | ${describeMcpRequest(req)}`,
      );
    }
    if (!transport) {
      noSessionError(req, res);
      return;
    }
    await transport.handleRequest(req, res, req.body);
  };

  // POST endpoint for MCP requests — handshake + all JSON-RPC calls go through the SDK transport.
  app.post('/mcp', authMW, async (req, res) => {
    try {
      installRpcResponseTrace(req, res);
      if (HANDSHAKE_DEBUG) {
        logger.info(`POST /mcp ← ${describeMcpRequest(req)}`);
      }
      // Rate limiting and the body-size limit stay here, before the transport takes over.
      const clientId = resolveRateLimitKey(req);
      await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'HTTP MCP', res, req.body?.id);
      if (res.headersSent) {
        return; // rate limit already responded
      }

      // Dedicated rate-limit bucket for tool calls (was inline in the old switch).
      if ((req.body as any)?.method === 'tools/call') {
        const toolCallClientId = resolveRateLimitKey(req, 'tool');
        await handleRateLimit(
          rateLimiter,
          toolCallClientId,
          req.ip || 'unknown',
          `tool call | tool: ${(req.body as any)?.params?.name || 'unknown'}`,
          res,
          (req.body as any)?.id,
        );
        if (res.headersSent) {
          return;
        }
      }

      const sessionId = req.headers[HTTP_SESSION_HEADER] as string | undefined;
      const existing = sessionId ? mcpTransports.get(sessionId) : undefined;
      if (existing) {
        if (HANDSHAKE_DEBUG) {
          logger.info(`POST /mcp reusing session ${shortSid(sessionId)} for method=${(req.body as any)?.method}`);
        }
        await runHttpToolCall(req, res, () => existing.handleRequest(req, res, req.body));
        return;
      }

      if (isInitializeRequest(req.body)) {
        logger.info(
          `MCP client initializing: protocolVersion: ${(req.body as any)?.params?.protocolVersion} | clientInfo: ${JSON.stringify((req.body as any)?.params?.clientInfo)}` +
            (HANDSHAKE_DEBUG ? ` | ${describeMcpRequest(req)}` : ''),
        );
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          // Standard §6 (MAY) — attach the EventStore only when resumability is enabled.
          ...(sseEventStore ? { eventStore: sseEventStore } : {}),
          onsessioninitialized: (sid: string) => {
            mcpTransports.set(sid, transport);
            evictOldestSession(sid);
            logger.info(`MCP session created: ${sid} (active sessions: ${mcpTransports.size})`);
          },
          onsessionclosed: (sid: string) => {
            mcpTransports.delete(sid);
            logger.info(`MCP session closed by client: ${shortSid(sid)} (active sessions: ${mcpTransports.size})`);
          },
        });
        // SDK `Transport` exposes `onclose` as a plain setter (not an EventTarget), so
        // `addEventListener` does not apply here — this is the canonical SDK pattern.
        // oxlint-disable-next-line unicorn/prefer-add-event-listener
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            mcpTransports.delete(sid);
            logger.info(`MCP transport closed: ${shortSid(sid)} (active sessions: ${mcpTransports.size})`);
          }
        };
        const server = createMcpServer('http');
        // Cast: SDK `Transport` types are stricter under `exactOptionalPropertyTypes`, but
        // `StreamableHTTPServerTransport` is a valid transport.
        await server.connect(transport as any);
        await runHttpToolCall(req, res, () => transport.handleRequest(req, res, req.body));
        return;
      }

      if (!sessionId && isSessionlessListRequest(req.body)) {
        await handleSessionlessListRequest(req, res);
        return;
      }

      // No session and not an `initialize` request → 400 per MCP transport semantics.
      noSessionError(req, res);
    } catch (error: Error | any) {
      if (!error.printed) {
        logger.error('MCP request failed', toError(error));
        error.printed = true;
      }
      if (!res.headersSent) {
        res
          .status(500)
          .json(createJsonRpcErrorResponse(error instanceof ServerError ? error : new ServerError(toStr(error))));
      }
    }
  });

  app.get('/mcp', authMW, async (req, res) => {
    await routeToSession(req, res);
  });

  app.delete('/mcp', authMW, async (req, res) => {
    await routeToSession(req, res);
  });

  // 404 handler for unknown routes
  app.use((req, res) => {
    const availableEndpoints: any = {
      home: 'GET /',
      health: 'GET /health',
      ready: 'GET /ready',
      checkToken: 'GET /ct?t=<token>, POST /ct',
      sse: 'GET /sse, POST /sse',
      messages: 'POST /messages',
      mcp: 'POST /mcp',
    };

    if (openAPIConfig) {
      availableEndpoints.swagger = 'GET /docs';
      availableEndpoints.openapi = 'GET /api/openapi.json';
      availableEndpoints.openapiYaml = 'GET /api/openapi.yaml';
    }
    if (appConfig.webServer.genJwtApiEnable) {
      availableEndpoints.genJwt = 'POST /gen-jwt';
    }
    if (isAdminEnabled) {
      availableEndpoints.admin = 'GET /admin';
    }
    if (appConfig.agentTester?.enabled) {
      availableEndpoints.agentTester = 'GET /agent-tester';
    }

    res.status(404).json({
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.path}`,
      availableEndpoints,
    });
  });

  // Error handling middleware (must have 4 parameters for Express to recognize it).
  // Special case: `express.json()` raises `entity.too.large` with `error.type === 'entity.too.large'`
  // when the request body exceeds `mcp.limits.maxPayloadBytes`. Standard §14 maps that to
  // JSON-RPC `-32005` / HTTP 413.
  app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error && error.type === 'entity.too.large') {
      logger.warn(`Payload too large from ip: ${req.ip}, limit: ${maxPayloadBytes}`);
      if (!res.headersSent) {
        const err = new PayloadTooLargeError(`Request body exceeds ${maxPayloadBytes} bytes`, {
          reason: 'payload_too_large',
        });
        res.status(err.statusCode).json(createJsonRpcErrorResponse(err, (req.body as any)?.id ?? null));
      }
      return;
    }

    logger.error('Express error handler', error);

    if (!res.headersSent) {
      res.status(500).json(createJsonRpcErrorResponse(error));
    }
  });

  // Start HTTP server. Bind address is driven by config — default is the loopback interface
  // (`127.0.0.1`) so the server is unreachable from the network until an operator opts in to
  // `0.0.0.0` or a specific NIC address. Standard §6.
  const { port, host } = appConfig.webServer;
  app.listen(port, host || '127.0.0.1', () => {
    let msg = `${chalk.magenta(appConfig.productName)} started with ${chalk.blue('HTTP')} transport on ${chalk.blue(host)}:${chalk.blue(port)}
Home page: http://localhost:${port}/`;
    if (isAdminEnabled) {
      msg += `\nAdmin panel: http://localhost:${port}/admin`;
    }
    if (appConfig.agentTester?.enabled) {
      msg += `\nAgent Tester: http://localhost:${port}/agent-tester`;
    }
    console.log(msg);
  });
}
