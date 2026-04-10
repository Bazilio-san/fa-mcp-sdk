/**
 * Agent Tester session-based authentication.
 *
 * When `agentTester.useAuth` is true:
 *  - Static assets (/, /static/*) are served without auth so the login page can render.
 *  - API requests (/api/*) require either a valid session cookie or an Authorization header
 *    (the latter is handled by authMW that follows in the middleware chain).
 *  - After a successful login via POST /api/auth/login a session cookie is issued.
 */

import crypto from 'crypto';

import chalk from 'chalk';
import { Request, Response, NextFunction, RequestHandler } from 'express';

import { appConfig } from '../bootstrap/init-config.js';
import { logger as lgr } from '../logger.js';

import { checkBasicAuth } from './basic.js';
import { checkJwtToken } from './jwt.js';
import { createAuthMW } from './middleware.js';
import { checkPermanentToken } from './permanent.js';
import { AuthResult } from './types.js';

const logger = lgr.getSubLogger({ name: chalk.yellow('agent-tester-auth') });

// ---------------------------------------------------------------------------
// In-memory session store
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const COOKIE_NAME = '__at_sid';

interface SessionEntry {
  createdAt: number;
  authInfo: AuthResult;
}

const sessions = new Map<string, SessionEntry>();

export function hasValidSession (req: Request): boolean {
  return !!getValidSession(req);
}

/** Periodic cleanup of expired sessions (every 30 min) */
setInterval(() => {
  const now = Date.now();
  for (const [sid, entry] of sessions) {
    if (now - entry.createdAt > SESSION_TTL_MS) {
      sessions.delete(sid);
    }
  }
}, 30 * 60 * 1000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseCookie (cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function getValidSession (req: Request): SessionEntry | undefined {
  const sid = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (!sid) {
    return undefined;
  }
  const entry = sessions.get(sid);
  if (!entry) {
    return undefined;
  }
  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    sessions.delete(sid);
    return undefined;
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Session CRUD (used by router endpoints)
// ---------------------------------------------------------------------------

export function createSession (authInfo: AuthResult): string {
  const sid = crypto.randomUUID();
  sessions.set(sid, { createdAt: Date.now(), authInfo });
  return sid;
}

export function deleteSession (req: Request): void {
  const sid = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (sid) {
    sessions.delete(sid);
  }
}

// ---------------------------------------------------------------------------
// Auth methods available for login
// ---------------------------------------------------------------------------

export function getAvailableAuthMethods (): string[] {
  const auth = appConfig.webServer?.auth;
  const methods: string[] = [];
  if (auth?.permanentServerTokens?.filter(Boolean).length) {
    methods.push('token');
  }
  if (auth?.basic?.username && auth?.basic?.password) {
    methods.push('basic');
  }
  if (auth?.jwtToken?.encryptKey) {
    methods.push('token'); // JWT tokens are entered as tokens
  }
  return [...new Set(methods)];
}

/**
 * Validate login credentials.
 * Returns AuthResult with success=true if valid.
 */
export function validateLoginCredentials (body: { token?: string; username?: string; password?: string }): AuthResult {
  const { token, username, password } = body;

  if (token) {
    // Try as permanent token first
    const permResult = checkPermanentToken(token);
    if (!permResult.errorReason) {
      return { success: true, authType: 'permanentServerTokens' };
    }
    // Try as JWT
    const jwtResult = checkJwtToken({ token });
    if (!jwtResult.errorReason) {
      return { success: true, authType: 'jwtToken', payload: jwtResult.payload };
    }
    return { success: false, error: 'Invalid token' };
  }

  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    return checkBasicAuth(encoded);
  }

  return { success: false, error: 'Provide token or username and password' };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const PUBLIC_PATHS = new Set<string>([
  '/',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/logout',
]);

function isPublicPath (path: string): boolean {
  return PUBLIC_PATHS.has(path) || path.startsWith('/static/');
}

/**
 * Returns the middleware chain that guards `/agent-tester`.
 *
 * When `agentTester.useAuth` is false → empty array (router is reachable without auth).
 * When true → a single middleware that:
 *   1. Lets static assets and auth endpoints through (login page must render).
 *   2. Accepts a valid session cookie (sets req.authInfo).
 *   3. Otherwise delegates to the universal authMW (Authorization header, headless API).
 */
export function createAgentTesterSessionMW (): RequestHandler[] {
  if (!appConfig.agentTester?.useAuth) {
    return [];
  }

  logger.info('Agent Tester session authentication enabled');
  const authMW = createAuthMW();

  const mw: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    if (isPublicPath(req.path)) {
      return next();
    }

    const session = getValidSession(req);
    if (session) {
      (req as any).authInfo = session.authInfo;
      return next();
    }

    return authMW(req, res, next);
  };

  return [mw];
}
