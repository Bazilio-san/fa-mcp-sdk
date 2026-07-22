import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { isADEnabled } from './ntlm-enabled.js';

let activeStackPromise: Promise<RequestHandler[]> | undefined;

type TNtlmModules = Awaited<
  ReturnType<
    () => Promise<
      [
        typeof import('ya-express-ntlm'),
        typeof import('./ntlm-auth-options.js'),
        typeof import('./ntlm-session-storage.js'),
        typeof import('./ntlm-templates.js'),
      ]
    >
  >
>;

function buildActiveNtlmStack([
  { authNTLM },
  { tokenGenNtlmOptions },
  sessionStorage,
  templates,
]: TNtlmModules): RequestHandler[] {
  const activeNtlmMiddleware = authNTLM(tokenGenNtlmOptions);
  return [
    sessionStorage.checkTokenGenSession(),
    (req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/login') {
        res.send(templates.getLoginPageHTML(req.ntlm?.username || ''));
        return;
      }

      if (req.path === '/logout') {
        console.log('[TOKEN-GEN] Logout requested');
        res.setHeader('WWW-Authenticate', 'NTLM');
        res.setHeader('Clear-Site-Data', '"cookies", "storage"');
        res.status(401).send('Authentication required - please login again');
        return;
      }

      if (req.path === '/debug/sessions' && process.env.NODE_ENV !== 'production') {
        res.json({
          message: 'Token Generation Server Session Statistics',
          timestamp: new Date().toISOString(),
          ...sessionStorage.getSessionStats(),
        });
        return;
      }

      if (req.path === '/health') {
        res.json({
          status: 'ok',
          service: 'token-generation-server',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (req.ntlm?.isAuthenticated) {
        console.log('[TOKEN-GEN] Request from authenticated user');
        next();
        return;
      }

      const authHeader = req.headers.authorization;
      if (authHeader && !authHeader.startsWith('NTLM ')) {
        delete req.headers.authorization;
      }
      activeNtlmMiddleware(req, res, next);
    },
  ];
}

/**
 * Load ya-express-ntlm only for an actual NTLM request. Importing the package initializes its
 * proxy-cache cleanup interval, so a top-level import would keep every non-NTLM CLI/test alive.
 */
function getActiveNtlmStack(): Promise<RequestHandler[]> {
  activeStackPromise ??= Promise.all([
    import('ya-express-ntlm'),
    import('./ntlm-auth-options.js'),
    import('./ntlm-session-storage.js'),
    import('./ntlm-templates.js'),
  ]).then((modules) => buildActiveNtlmStack(modules as TNtlmModules));
  return activeStackPromise;
}

function runStack(stack: RequestHandler[], req: Request, res: Response, done: NextFunction): void {
  let index = 0;
  const next: NextFunction = (error?: any) => {
    if (error) {
      done(error);
      return;
    }
    const handler = stack[index++];
    if (!handler) {
      done();
      return;
    }
    try {
      handler(req, res, next);
    } catch (caught) {
      done(caught);
    }
  };
  next();
}

/** Return one lazy middleware so non-NTLM auth modes never initialize ya-express-ntlm. */
export const setupNTLMAuthentication = (): RequestHandler[] => {
  if (!isADEnabled) {
    return [
      (req: Request, _res: Response, next: NextFunction) => {
        req.ntlm = {
          isAuthenticated: false,
          username: 'Anonymous',
          domain: 'NoAuth',
        };
        next();
      },
    ];
  }

  return [
    (req: Request, res: Response, next: NextFunction) => {
      // eslint-disable-next-line promise/no-promise-in-callback -- lazy ESM import bridged to Express callbacks
      void getActiveNtlmStack()
        .then((stack) => runStack(stack, req, res, next))
        // eslint-disable-next-line promise/no-callback-in-promise -- Express owns error propagation
        .catch(next);
    },
  ];
};
