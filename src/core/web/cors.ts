import cors from 'cors';
import { Express, NextFunction, Request, Response } from 'express';

import { config } from '../bootstrap/init-config.js';

const { originHosts } = config.webServer;

/** Exact CORS allow-list match. Bare hostnames allow any port; entries with a scheme or port match exactly. */
export function isOriginAllowed(origin: string, allowed: string[] = originHosts): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
    return false;
  }

  return allowed.some((rawEntry) => {
    const entry = String(rawEntry ?? '')
      .trim()
      .toLowerCase();
    if (!entry || entry === '*') {
      return false;
    }
    if (entry.includes('://')) {
      try {
        const allowedUrl = new URL(entry);
        return (
          allowedUrl.pathname === '/' &&
          !allowedUrl.search &&
          !allowedUrl.hash &&
          allowedUrl.origin === originUrl.origin
        );
      } catch {
        return false;
      }
    }
    try {
      const allowedUrl = new URL(`http://${entry}`);
      if (allowedUrl.pathname !== '/' || allowedUrl.search || allowedUrl.hash) {
        return false;
      }
      return entry.includes(':') ? allowedUrl.host === originUrl.host : allowedUrl.hostname === originUrl.hostname;
    } catch {
      return false;
    }
  });
}

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
      if (!origin || isOriginAllowed(origin)) {
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
