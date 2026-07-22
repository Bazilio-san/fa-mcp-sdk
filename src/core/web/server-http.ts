import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { InMemoryEventStore } from './event-store.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import chalk from 'chalk';
import express from 'express';
import helmet from 'helmet';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import { ITransportContext } from '../_types_/types.js';
import { createAgentTesterRouter } from '../agent-tester/agent-tester-router.js';
import { validateAdminAuthConfig } from '../auth/admin-auth.js';
import { createAgentTesterSessionMW } from '../auth/agent-tester-auth.js';
import { checkJwtToken, generateToken, MIN_ENCRYPT_KEY_LENGTH } from '../auth/jwt.js';
import { buildLocalJwks, canLocallyIssueJwt, getJwtRuntimeConfig } from '../auth/key-resolver.js';
import { createAuthMW } from '../auth/middleware.js';
import { checkPermanentToken } from '../auth/permanent.js';
import { isUsableAuthIdentity } from '../auth/principal.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { getMainDBConnectionStatus } from '../db/pg-db.js';
import { createJsonRpcErrorResponse, logInternalError, ServerError } from '../errors/errors.js';
import {
  PayloadTooLargeError,
  RateLimitedError,
  ResourceNotFoundError,
  TimeoutError,
} from '../errors/specific-errors.js';
import { logger as lgr } from '../logger.js';
import { getMetrics, getMetricsRegistry, initMetrics } from '../metrics/metrics.js';
import { createMcpServer } from '../mcp/create-mcp-server.js';
import { formatRateLimitError, isRateLimitError } from '../utils/rate-limit.js';
import { normalizeTransportHeaders } from '../utils/utils.js';

import { createAdminRouter } from './admin-router.js';
import { applyCors } from './cors.js';
import { faviconSvg } from './favicon-svg.js';
import { handleHomeInfo } from './home-api.js';
import { createOAuthRouter } from './oauth-router.js';
import { configureOpenAPI, createSwaggerUIAssetsMiddleware } from './openapi.js';
import { requestIdMW } from './request-id.js';
import { resolveRateLimitKey } from './rate-limit-key.js';
import { createSvgRouter } from './svg-icons.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to static files
const staticPath = join(__dirname, 'static');

const logger = lgr.getSubLogger({ name: chalk.bgYellow('server-http') });

export const isAdminEnabled = appConfig.adminPanel?.enabled === true;

const READINESS_CHECK_TIMEOUT_MS = 3_000;
const READINESS_CACHE_TTL_MS = 1_000;
const isProduction = (process.env.NODE_CONSUL_ENV || process.env.NODE_ENV) === 'production';

type ReadinessCheckStatus = 'ok' | 'error' | 'skipped';
type ReadinessResponse = {
  status: 'ready' | 'not_ready';
  checks: Record<string, ReadinessCheckStatus>;
};

async function withReadinessTimeout<T>(check: () => Promise<T> | T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(check),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('readiness timeout')), READINESS_CHECK_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function checkJwksReadiness(): Promise<'ok' | 'error' | 'skipped'> {
  const auth = appConfig.webServer?.auth;
  const jwt = getJwtRuntimeConfig();
  if (!auth?.enabled || jwt.mode === 'legacyAesCtr') {
    return 'skipped';
  }
  try {
    if (jwt.mode === 'remoteJwks') {
      const response = await fetch(jwt.jwksUri, { signal: AbortSignal.timeout(READINESS_CHECK_TIMEOUT_MS) });
      if (!response.ok) {
        return 'error';
      }
      const document = (await response.json()) as { keys?: unknown[] };
      return Array.isArray(document.keys) && document.keys.length > 0 ? 'ok' : 'error';
    }
    const document = await withReadinessTimeout(() => buildLocalJwks());
    return Array.isArray(document.keys) && document.keys.length > 0 ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

/**
 * Handle rate limiting with consistent error response
 */
async function handleRateLimit(
  rateLimiter: RateLimiterMemory,
  clientId: string,
  _ip: string,
  context: string = '',
  res?: express.Response,
  id?: any,
): Promise<void> {
  try {
    await rateLimiter.consume(clientId);
  } catch (rateLimitError) {
    if (isRateLimitError(rateLimitError)) {
      const rateLimitMessage = formatRateLimitError(rateLimitError as any, appConfig.mcp.rateLimit.maxRequests);
      logger.warn(`Rate limit exceeded${context ? ` in ${context}` : ''}`);

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
  // Inert JWT/OAuth placeholders must not expose discovery or token routes while auth is disabled.
  if (appConfig.webServer.auth.enabled === true && getJwtRuntimeConfig().mode !== 'legacyAesCtr') {
    app.use(createOAuthRouter());
  }

  app.use(faviconSvg());

  // Serve static files (CSS, JS, SVG)
  app.use('/static', express.static(staticPath));

  // SVG icons with color substitution
  app.use('/svg', createSvgRouter());

  // Home page API endpoint
  app.get('/api/home-info', authMW, handleHomeInfo);

  // Root endpoint - serve static Home page
  app.get('/', (req, res) => {
    res.sendFile(join(staticPath, 'home', 'index.html'));
  });

  // Liveness is process-only: dependency failures belong to /ready and must not restart a live
  // process. This endpoint is mounted before auth middleware and intentionally stays public.
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      version: appConfig.version,
      uptime: process.uptime(),
    });
  });

  // Standard §15.3 — Prometheus metrics endpoint. Opt-in (default off), authenticated by default,
  // and unconditionally protected in production even if startHttpServer() is called without preflight.
  if (metricsEnabled) {
    const metricsPath = metricsCfg?.path || '/metrics';
    const metricsAuth = isProduction || metricsCfg?.requireAuth !== false ? [authMW] : [];
    app.get(metricsPath, ...metricsAuth, async (_req, res) => {
      try {
        const reg = getMetricsRegistry();
        res.setHeader('Content-Type', reg.contentType);
        res.end(await reg.metrics());
      } catch (err) {
        logInternalError(err, 'metrics_render');
        res.status(500).send('Failed to render metrics');
      }
    });
  }

  // Readiness checks are cached briefly and concurrent probes share one evaluation. Custom checks
  // also retain their in-flight promise after the public timeout, preventing an unauthenticated
  // probe flood from launching unbounded copies of a dependency call that cannot be cancelled.
  let readinessCache: { expiresAt: number; response: ReadinessResponse } | undefined;
  let readinessInFlight: Promise<ReadinessResponse> | undefined;
  const customCheckInFlight = new Map<string, Promise<boolean | 'ok'>>();

  const runCustomReadinessCheck = (name: string, check: () => boolean | 'ok' | Promise<boolean | 'ok'>) => {
    const current = customCheckInFlight.get(name);
    if (current) {
      return current;
    }
    const started = Promise.resolve().then(check);
    customCheckInFlight.set(name, started);
    void started.then(
      () => customCheckInFlight.delete(name),
      () => customCheckInFlight.delete(name),
    );
    return started;
  };

  const computeReadiness = async (): Promise<ReadinessResponse> => {
    const checks: Record<string, ReadinessCheckStatus> = {};
    let ready = true;

    if (appConfig.isMainDBUsed) {
      try {
        const dbStatus = await withReadinessTimeout(() => getMainDBConnectionStatus());
        checks.db = dbStatus === 'connected' ? 'ok' : 'error';
      } catch {
        checks.db = 'error';
      }
      if (checks.db === 'error') {
        ready = false;
      }
    }

    // Cache singleton: trivially available; surface it for diagnostic completeness.
    checks.cache = 'ok';

    checks.jwks = await checkJwksReadiness();
    if (checks.jwks === 'error') {
      ready = false;
    }

    const customChecks = getProjectData().readinessChecks ?? {};
    await Promise.all(
      Object.entries(customChecks).map(async ([name, check]) => {
        try {
          const result = await withReadinessTimeout(() => runCustomReadinessCheck(name, check));
          checks[name] = result === true || result === 'ok' ? 'ok' : 'error';
        } catch {
          checks[name] = 'error';
        }
        if (checks[name] === 'error') {
          ready = false;
        }
      }),
    );

    return {
      status: ready ? 'ready' : 'not_ready',
      checks,
    };
  };

  const getReadiness = (): Promise<ReadinessResponse> => {
    const now = Date.now();
    if (readinessCache && readinessCache.expiresAt > now) {
      return Promise.resolve(readinessCache.response);
    }
    if (!readinessInFlight) {
      readinessInFlight = computeReadiness()
        .then((response) => {
          readinessCache = { expiresAt: Date.now() + READINESS_CACHE_TTL_MS, response };
          return response;
        })
        .finally(() => {
          readinessInFlight = undefined;
        });
    }
    return readinessInFlight;
  };

  // Readiness probe (standard §16.2) — no authentication; reports whether every dependency
  // the server needs to serve traffic is up. Empty / sensitive details are NEVER returned —
  // each check is reduced to `ok` / `error`.
  app.get('/ready', async (_req, res) => {
    const response = await getReadiness();
    res.status(response.status === 'ready' ? 200 : 503).json(response);
  });

  // Token check endpoint: POST /ct {"t": "<token>"}. Standard §7.1 forbids secrets in URL.
  // GET /ct?t=<token> is gated behind webServer.tokenCheck.allowQueryToken (non-prod only).
  const handleTokenCheck = async (req: express.Request, res: express.Response) => {
    await handleRateLimit(
      rateLimiter,
      resolveRateLimitKey(req, 'token-check'),
      req.ip || 'unknown',
      'token_check',
      res,
      null,
    );
    if (res.headersSent) {
      return;
    }
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
      return res.json({ success: true, type: 'jwt' });
    }

    return res.status(401).json({ success: false, error: 'Unauthorized' });
  };
  const allowQueryToken = appConfig.webServer.tokenCheck?.allowQueryToken === true && !isProduction;
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
    const requireTokenIssuerScope = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!isProduction) {
        return next();
      }
      const scopes = new Set(
        String((req as any).authInfo?.payload?.scope ?? '')
          .split(/\s+/)
          .filter(Boolean),
      );
      if (!scopes.has('admin:token:issue')) {
        getMetrics()?.authFailures.inc({ reason: 'missing_scope' });
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      return next();
    };
    const jwtMode = getJwtRuntimeConfig().mode;
    const encryptKey = appConfig.webServer.auth?.jwtToken?.encryptKey;
    const legacyKeyMissing =
      jwtMode === 'legacyAesCtr' && (!encryptKey || encryptKey.length < MIN_ENCRYPT_KEY_LENGTH || encryptKey === '***');

    if (legacyKeyMissing) {
      logger.error('genJwtApiEnable is true but webServer.auth.jwtToken.encryptKey is not configured');
    } else if (jwtMode === 'remoteJwks') {
      app.post('/gen-jwt', authMW, requireTokenIssuerScope, (_req: express.Request, res: express.Response) => {
        res.status(501).json({
          success: false,
          error: 'cannot_issue_token',
          error_description: 'This server does not issue JWTs. Obtain a token from the configured identity provider.',
        });
      });
    } else {
      const TTL_MULTIPLIERS: Record<string, number> = { s: 1, m: 60, d: 86400, y: 31536000 };

      app.post('/gen-jwt', authMW, requireTokenIssuerScope, async (req: express.Request, res: express.Response) => {
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
              .json({ success: false, error: 'Invalid ttl format. Expected: <N>s | <N>m | <N>d | <N>y' });
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
          logInternalError(error, 'jwt_token_generation');
          return res.status(500).json({ success: false, error: 'Internal error' });
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

  // A session id is a routing/correlation value, never proof of authorization. Bind every
  // stateful transport to the credentials and delegated identity that initialized it. Only a
  // SHA-256 digest is retained; bearer tokens and caller headers never enter logs or session state.
  const getSessionAuthBinding = (req: express.Request): string => {
    if (!appConfig.webServer.auth.enabled) {
      return 'auth-disabled';
    }
    const { authInfo } = req as any;
    if (!authInfo?.success || !isUsableAuthIdentity(authInfo.principal)) {
      throw new Error('Authenticated request does not have a stable principal');
    }
    const material = JSON.stringify({
      version: 1,
      onBehalfOf: req.headers['x-on-behalf-of-user'] ?? '',
      authType: authInfo?.authType ?? '',
      principal: authInfo?.principal ?? '',
      customBinding: authInfo?.sessionBinding ?? '',
    });
    return createHash('sha256').update(material).digest('hex');
  };

  const rejectSessionBinding = (res: express.Response, id: unknown): void => {
    getMetrics()?.authFailures.inc({ reason: 'forbidden' });
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Forbidden', data: { reason: 'session_auth_mismatch' } },
      id: id ?? null,
    });
  };

  // Deprecated HTTP+SSE transport. It is absent unless explicitly enabled as a migration opt-in.
  // When enabled, including during a documented production migration, all methods use createMcpServer's
  // canonical validation, scope, concurrency, timeout, output-schema and result-size pipeline.
  const legacySseEnabled = appConfig.mcp.legacySse?.enabled === true;
  if (legacySseEnabled) {
    type LegacySseSession = {
      transport: SSEServerTransport;
      server: ReturnType<typeof createMcpServer>;
      authBinding: string;
    };
    const sseTransports = new Map<string, LegacySseSession>();

    const createSseServer = (preservedHeaders: Record<string, string>, authInfo?: any) =>
      createMcpServer('sse', {
        contextProvider: (_extra, defaultContext) => ({
          transport: 'sse',
          headers: preservedHeaders,
          ...(authInfo?.payload ? { payload: authInfo.payload as ITransportContext['payload'] } : {}),
          ...(typeof authInfo?.principal === 'string' ? { principal: authInfo.principal } : {}),
          ...(defaultContext.clientCapabilities ? { clientCapabilities: defaultContext.clientCapabilities } : {}),
        }),
      });

    app.get('/sse', authMW, async (req, res) => {
      try {
        const clientId = resolveRateLimitKey(req, 'sse');
        await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'SSE', res, 1);
        if (res.headersSent) {
          return;
        }

        const preservedHeaders = normalizeTransportHeaders(req.headers);
        const { authInfo } = req as any;
        const transport = new SSEServerTransport('/sse', res);
        const sseServer = createSseServer(preservedHeaders, authInfo);
        sseTransports.set(transport.sessionId, {
          transport,
          server: sseServer,
          authBinding: getSessionAuthBinding(req),
        });

        res.on('close', () => {
          sseTransports.delete(transport.sessionId);
          void sseServer.close().catch(() => {});
          logger.info(`Legacy SSE client disconnected: ${shortSid(transport.sessionId)}`);
        });

        await sseServer.connect(transport);
        logger.info('Legacy SSE connection established');
      } catch (error) {
        logInternalError(error, 'legacy_sse_connection');
        if (!res.headersSent) {
          res.status(500).json(createJsonRpcErrorResponse(new ServerError('Failed to establish SSE connection')));
        }
      }
    });

    app.post('/messages', authMW, async (req, res): Promise<void> => {
      try {
        const sessionId = String(req.query.sessionId ?? '');
        if (!sessionId) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32602, message: 'Session ID required' },
            id: req.body?.id ?? null,
          });
          return;
        }

        const session = sseTransports.get(sessionId);
        if (!session) {
          const err = new ResourceNotFoundError('SSE session not found');
          res.status(err.statusCode).json(createJsonRpcErrorResponse(err, req.body?.id ?? null));
          return;
        }
        if (session.authBinding !== getSessionAuthBinding(req)) {
          rejectSessionBinding(res, req.body?.id);
          return;
        }

        const clientId = resolveRateLimitKey(req, 'legacy-sse-message');
        await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'legacy SSE message', res, req.body?.id);
        if (res.headersSent) {
          return;
        }
        await session.transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        logInternalError(error, 'legacy_sse_message');
        if (!res.headersSent) {
          res.status(500).json(createJsonRpcErrorResponse(new ServerError('Failed to handle SSE message')));
        }
      }
    });

    // Non-standard compatibility route used by the legacy test client. Without a sessionId it may
    // select only a session opened with exactly the same authentication binding.
    app.post('/sse', authMW, async (req, res): Promise<void> => {
      try {
        const authBinding = getSessionAuthBinding(req);
        const sessionId = String(req.query.sessionId ?? '');
        const session = sessionId
          ? sseTransports.get(sessionId)
          : Array.from(sseTransports.values()).find((candidate) => candidate.authBinding === authBinding);

        if (!session) {
          const err = new ResourceNotFoundError('No matching SSE session. Connect via GET /sse first.');
          res.status(err.statusCode).json(createJsonRpcErrorResponse(err, req.body?.id ?? null));
          return;
        }
        if (session.authBinding !== authBinding) {
          rejectSessionBinding(res, req.body?.id);
          return;
        }

        const clientId = resolveRateLimitKey(req, 'legacy-sse-direct');
        await handleRateLimit(rateLimiter, clientId, req.ip || 'unknown', 'legacy SSE POST', res, req.body?.id);
        if (res.headersSent) {
          return;
        }
        await session.transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        logInternalError(error, 'legacy_sse_post');
        if (!res.headersSent) {
          res.status(500).json(createJsonRpcErrorResponse(new ServerError('Failed to handle SSE POST request')));
        }
      }
    });
  }

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
  const shortSid = (sid?: string): string =>
    sid ? createHash('sha256').update(sid).digest('hex').slice(0, 8) : 'none';
  // Summarize the request line for handshake tracing: JSON-RPC method, id, session header,
  // and presence of the headers that matter for the MCP transport contract.
  const describeMcpRequest = (req: express.Request): string => {
    const body = req.body as any;
    const h = req.headers;
    const hasAuth = !!(h.authorization || h['x-on-behalf-of-user']);
    const rawMethod = typeof body?.method === 'string' ? body.method : '';
    const method = /^[A-Za-z][A-Za-z0-9_./-]{0,127}$/.test(rawMethod) ? rawMethod : rawMethod ? '(invalid)' : '(none)';
    const rawProtocol = (h['mcp-protocol-version'] as string) || body?.params?.protocolVersion || '';
    const protocolVersion = /^\d{4}-\d{2}-\d{2}$/.test(rawProtocol)
      ? rawProtocol
      : rawProtocol
        ? '(invalid)'
        : '(none)';
    return [
      `method=${method}`,
      `id=${body && Object.hasOwn(body, 'id') ? 'present' : 'none'}`,
      `session=${shortSid(h[HTTP_SESSION_HEADER] as string | undefined)}`,
      `protocolVersion=${protocolVersion}`,
      `auth=${hasAuth ? 'yes' : 'no'}`,
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
            logger.warn(
              `MCP RPC error response → HTTP ${res.statusCode} | code=${Number.isInteger(m.error.code) ? m.error.code : 'unknown'} ` +
                `| for: ${describeMcpRequest(req)}`,
            );
          }
        } else if (RPC_DEBUG) {
          const summary = messages
            .map((m) =>
              m.error
                ? `error ${m.error.code}`
                : m.result !== undefined
                  ? `result=ok`
                  : m.method
                    ? `notif ${m.method}`
                    : `response`,
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
  type HttpMcpSession = {
    transport: StreamableHTTPServerTransport;
    authBinding: string;
  };
  const mcpTransports = new Map<string, HttpMcpSession>();
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
      const session = mcpTransports.get(oldest);
      mcpTransports.delete(oldest);
      void session?.transport.close();
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
        const err = new TimeoutError(`Tool call exceeded ${timeoutMs} ms timeout`, {
          reason: 'tool_timeout',
        });
        logger.warn(`Tool timeout (${timeoutMs} ms)`);
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
    const session = sessionId ? mcpTransports.get(sessionId) : undefined;
    if (HANDSHAKE_DEBUG) {
      logger.info(
        `MCP ${req.method} /mcp routing to session ${shortSid(sessionId)}: ` +
          `${session ? 'found' : 'NOT FOUND'} | ${describeMcpRequest(req)}`,
      );
    }
    if (!session) {
      noSessionError(req, res);
      return;
    }
    if (session.authBinding !== getSessionAuthBinding(req)) {
      rejectSessionBinding(res, (req.body as any)?.id);
      return;
    }
    await session.transport.handleRequest(req, res, req.body);
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
          'tool_call',
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
        if (existing.authBinding !== getSessionAuthBinding(req)) {
          rejectSessionBinding(res, (req.body as any)?.id);
          return;
        }
        if (HANDSHAKE_DEBUG) {
          logger.info(`POST /mcp reusing session ${shortSid(sessionId)} | ${describeMcpRequest(req)}`);
        }
        await runHttpToolCall(req, res, () => existing.transport.handleRequest(req, res, req.body));
        return;
      }

      if (isInitializeRequest(req.body)) {
        const authBinding = getSessionAuthBinding(req);
        logger.info(
          `MCP client initializing: clientInfo=${(req.body as any)?.params?.clientInfo ? 'present' : 'none'}` +
            (HANDSHAKE_DEBUG ? ` | ${describeMcpRequest(req)}` : ''),
        );
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          // Standard §6 (MAY) — attach the EventStore only when resumability is enabled.
          ...(sseEventStore ? { eventStore: sseEventStore } : {}),
          onsessioninitialized: (sid: string) => {
            mcpTransports.set(sid, { transport, authBinding });
            evictOldestSession(sid);
            logger.info(`MCP session created: ${shortSid(sid)} (active sessions: ${mcpTransports.size})`);
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
      const errorRecord = error && typeof error === 'object' ? error : undefined;
      if (!errorRecord?.printed) {
        logInternalError(error, 'mcp_request');
        if (errorRecord) {
          errorRecord.printed = true;
        }
      }
      if (!res.headersSent) {
        res.status(500).json(createJsonRpcErrorResponse(new ServerError('MCP request failed')));
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
  app.use((_req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'Endpoint not found',
    });
  });

  // Error handling middleware (must have 4 parameters for Express to recognize it).
  // Special case: `express.json()` raises `entity.too.large` with `error.type === 'entity.too.large'`
  // when the request body exceeds `mcp.limits.maxPayloadBytes`. Standard §14 maps that to
  // JSON-RPC `-32005` / HTTP 413.
  app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error && error.type === 'entity.too.large') {
      logger.warn(`Payload too large: limit=${maxPayloadBytes}`);
      if (!res.headersSent) {
        const err = new PayloadTooLargeError(`Request body exceeds ${maxPayloadBytes} bytes`, {
          reason: 'payload_too_large',
        });
        res.status(err.statusCode).json(createJsonRpcErrorResponse(err, (req.body as any)?.id ?? null));
      }
      return;
    }

    logInternalError(error, 'express_error_handler');

    if (!res.headersSent) {
      res.status(500).json(createJsonRpcErrorResponse(error));
    }
  });

  // Start HTTP server. Bind address is driven by config — default is the loopback interface
  // (`127.0.0.1`) so the server is unreachable from the network until an operator opts in to
  // `0.0.0.0` or a specific NIC address. Standard §6.
  const { port, host } = appConfig.webServer;
  app.listen(port, host || '127.0.0.1', () => {
    let msg = `${chalk.magenta('MCP server')} started with ${chalk.blue('HTTP')} transport`;
    if (isAdminEnabled) {
      msg += '\nAdmin panel enabled';
    }
    if (appConfig.agentTester?.enabled) {
      msg += '\nAgent Tester enabled';
    }
    console.log(msg);
  });
}
