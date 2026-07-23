import cors from 'cors';
import { Express, NextFunction, Request, Response } from 'express';

import { config } from '../bootstrap/init-config.js';

const { originHosts, cors: corsCfg } = config.webServer;

/** CORS origin guard is on by default; only `webServer.cors.enabled === false` turns it off. */
const corsGuardEnabled = corsCfg?.enabled !== false;

const originTestRe = new RegExp(`https?:\\/\\/(${originHosts.join('|')})(:\\d+)?`, 'i');

/**
 * CORS setup (standard §6).
 *
 * Default (`webServer.cors.enabled` !== false) — an origin guard: requests carrying an `Origin`
 * header NOT covered by `webServer.originHosts` are rejected with HTTP 403 + a JSON-RPC error body.
 * Same-origin requests (no `Origin` header) and tools (curl, MCP test clients) pass through.
 *
 * Disabled (`webServer.cors.enabled === false`) — the guard is NOT installed. Instead the server
 * adds `Access-Control-Allow-Origin: *` to every response and answers preflight requests, so public
 * endpoints work when fetched cross-origin from sandboxed iframes (MCP Apps widgets) whose `Origin`
 * is `null` or a dynamic host subdomain that can never match `originHosts`. This opens the server to
 * every origin — protect it by network policy / a reverse proxy. Production start-up is allowed only
 * because disabling the guard is an explicit, deliberate choice (see init-mcp-server.ts).
 *
 * Production-time refusal of an empty `originHosts` allow-list (while the guard is on) is enforced in
 * `validateProductionWebServerConfig()` so the server never silently degrades to "allow everything".
 */
export const applyCors = (app: Express) => {
  if (!corsGuardEnabled) {
    // Allow every origin: `cors({ origin: '*' })` sets `Access-Control-Allow-Origin: *` on all
    // responses and short-circuits preflight (OPTIONS) requests.
    app.use(cors({ origin: '*' }));
    return;
  }

  const corsOptions = {
    origin(origin: any, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin || originTestRe.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS_ORIGIN_NOT_ALLOWED'));
      }
    },
  };

  app.use(cors(corsOptions));

  // Convert the CORS rejection into a 403 with a structured JSON-RPC error instead of letting
  // Express fall through to the generic 500 handler.
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err && err.message === 'CORS_ORIGIN_NOT_ALLOWED') {
      return res.status(403).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Origin not allowed by CORS policy',
          data: { reason: 'origin_not_allowed' },
        },
      });
    }
    return next(err);
  });

  return corsOptions;
};
