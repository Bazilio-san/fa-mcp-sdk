import cors from 'cors';
import { Express, NextFunction, Request, Response } from 'express';

import { config } from '../bootstrap/init-config.js';

const { originHosts } = config.webServer;

const originTestRe = new RegExp(`https?:\\/\\/(${originHosts.join('|')})(:\\d+)?`, 'i');

/**
 * CORS guard (standard §6). Requests carrying an `Origin` header that is NOT covered by
 * `webServer.originHosts` are rejected with HTTP 403 + a JSON-RPC error body. Same-origin
 * requests (no `Origin` header) and tools (curl, MCP test clients) pass through.
 *
 * Production-time refusal of the "allow everything" configuration is enforced in
 * `validateProductionWebServerConfig()` so the server never starts in that state.
 */
export const applyCors = (app: Express) => {
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
