// noinspection UnnecessaryLocalVariableJS
import { NextFunction, Request, Response } from 'express';

import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { debugTokenAuth } from '../debug.js';
import { getMetrics } from '../metrics/metrics.js';
import { logger as lgr } from '../logger.js';
import { buildWwwAuthenticateHeader } from '../web/oauth-router.js';
import { getCurrentRequestId } from '../web/request-id.js';

import { checkMultiAuth, logAuthConfiguration } from './multi-auth.js';
import { normalizeAuthPrincipal } from './principal.js';
import { AuthResult } from './types.js';

const { enabled: authEnabled } = appConfig.webServer.auth;
const isProduction = (process.env.NODE_CONSUL_ENV || process.env.NODE_ENV) === 'production';
const logger = lgr.getSubLogger({ name: 'auth-middleware' });

function logAuthRejection(reason: string, status: 401 | 403 | 500): void {
  logger.warn('Authentication rejected', {
    reason,
    requestId: getCurrentRequestId() ?? null,
    status,
  });
}

const debugAuth = (req: Request, code: number, message: string): { code: number; message: string } => {
  if (debugTokenAuth.enabled) {
    const headerCount = req.headers ? Object.keys(req.headers).length : 0;
    debugTokenAuth(
      `Authentication rejected code=${code} headerCount=${headerCount} ` +
        `authorizationPresent=${Boolean(req.headers?.authorization)}`,
    );
  }
  return { code, message };
};

// Legacy functions removed - use createAuthMW() instead

/**
 * Check if a resource URI is public (doesn't require authentication)
 */
const isPublicResource = async (uri: string): Promise<boolean> => {
  if (isProduction) {
    return false;
  }
  const projectData = getProjectData();
  const entries = Array.isArray(projectData?.customResources) ? projectData.customResources : [];
  const resource = entries.find((entry) => entry.uri === uri);
  const scopes = resource?.requiredScopes ?? projectData?.defaultReadScopes;
  return resource?.requireAuth === false && (!Array.isArray(scopes) || scopes.length === 0);
};

/**
 * Check if a prompt name is public (doesn't require authentication)
 */
const isPublicPrompt = async (name: string): Promise<boolean> => {
  if (isProduction) {
    return false;
  }
  const projectData = getProjectData();
  const entries = Array.isArray(projectData?.customPrompts) ? projectData.customPrompts : [];
  const prompt = entries.find((entry) => entry.name === name);
  const scopes = prompt?.requiredScopes ?? projectData?.defaultReadScopes;
  return prompt?.requireAuth === false && (!Array.isArray(scopes) || scopes.length === 0);
};

/**
 * Check if the current MCP request is for a public resource or prompt
 */
const isPublicMcpRequest = async (req: Request): Promise<boolean> => {
  const { method } = req.body || {};

  switch (method) {
    case 'ping':
    case 'notifications/initialized':
      return true;

    case 'resources/read': {
      const uri = req.body?.params?.uri;
      return uri ? await isPublicResource(uri) : false;
    }

    case 'prompts/get': {
      const name = req.body?.params?.name;
      return name ? await isPublicPrompt(name) : false;
    }

    default:
      // All other methods require authentication
      return false;
  }
};

function authFailureReason(error?: string): string {
  const value = String(error ?? '').toLowerCase();
  if (value.includes('credentials not provided')) {
    return 'credentials_missing';
  }
  if (value.includes('expired')) {
    return 'token_expired';
  }
  if (value.includes('signature')) {
    return 'invalid_signature';
  }
  if (value.includes('revoked')) {
    return 'token_revoked';
  }
  if (value.includes('not configured')) {
    return 'method_not_configured';
  }
  return 'invalid_credentials';
}

// Legacy middleware functions removed - use createAuthMW() instead

/**
 * Programmatic authentication checking - for manual auth validation in code
 * Returns error object if authentication failed, undefined if successful
 */
export const getMultiAuthError = async (req: Request): Promise<{ code: number; message: string } | undefined> => {
  if (!authEnabled) {
    return undefined;
  }

  const authResult = await checkMultiAuth(req);
  if (!authResult.success) {
    const status = authResult.forbidden ? 403 : 401;
    logAuthRejection(authResult.forbidden ? 'forbidden' : authFailureReason(authResult.error), status);
    return debugAuth(req, status, authResult.forbidden ? 'Forbidden' : 'Unauthorized');
  }

  // Add authentication information to request for use in application
  const normalizedAuth = normalizeAuthPrincipal(authResult);
  if (!normalizedAuth.success) {
    logAuthRejection(authFailureReason(normalizedAuth.error), 401);
    return debugAuth(req, 401, 'Unauthorized');
  }
  (req as any).authInfo = normalizedAuth;
  (req as any).auth = normalizedAuth; // SDK transport bridge — see createAuthMW

  return undefined;
};

// ========================================================================
// UNIVERSAL AUTHENTICATION MIDDLEWARE
// ========================================================================

interface AuthMiddlewareOptions {
  mcpPaths?: string[]; // Paths to check for public MCP requests (default: ['/mcp', '/messages', '/sse'])
  logConfig?: boolean; // Log auth configuration on first request (default: from LOG_AUTH_CONFIG env)
}

/**
 * Universal authentication middleware - handles all authentication scenarios
 */
export function createAuthMW(options: AuthMiddlewareOptions = {}) {
  const { mcpPaths = ['/mcp', '/messages', '/sse'], logConfig = process.env.LOG_AUTH_CONFIG === 'true' } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // If authInfo is already set by an upstream middleware (e.g. Agent Tester session), skip
    if ((req as any).authInfo?.success) {
      const normalizedAuth = normalizeAuthPrincipal((req as any).authInfo);
      if (!normalizedAuth.success) {
        getMetrics()?.authFailures.inc({ reason: authFailureReason(normalizedAuth.error) });
        logAuthRejection(authFailureReason(normalizedAuth.error), 401);
        const errorDetails = debugAuth(req, 401, 'Unauthorized');
        res.setHeader('WWW-Authenticate', buildWwwAuthenticateHeader(req, { errorReason: 'invalid_token' }));
        return res.status(errorDetails.code).send(errorDetails.message);
      }
      (req as any).authInfo = normalizedAuth;
      (req as any).auth = normalizedAuth;
      return next();
    }

    // Log configuration on first request
    if (logConfig && !(createAuthMW as any)._logged) {
      logAuthConfiguration();
      (createAuthMW as any)._logged = true;
    }

    // Only explicitly public protocol methods remain callable without credentials. `initialize`
    // is deliberately authenticated: a stateful session must never be created without an owner.
    // When credentials are supplied for a public method we still validate and attach authInfo.
    const isMcpRequest = mcpPaths.includes(req.path);

    // Skip authentication if disabled
    if (!authEnabled) {
      return next();
    }

    try {
      // Use enhanced combined authentication (standard + custom validator)
      const authResult: AuthResult = await checkMultiAuth(req);
      if (!authResult.success) {
        // Credential-less ping/initialized remain public for protocol negotiation.
        // Explicit but invalid/revoked credentials must fail; silently accepting them would make
        // the subsequent session look authenticated to a client even though no identity was bound.
        if (authFailureReason(authResult.error) === 'credentials_missing') {
          const isPublicRequest = isMcpRequest && (await isPublicMcpRequest(req));
          if (isPublicRequest) {
            return next();
          }
        }
        // Standard §7.4 — forbidden (authenticated but lacking permission) → 403, NO WWW-Authenticate.
        if (authResult.forbidden) {
          getMetrics()?.authFailures.inc({ reason: 'forbidden' });
          logAuthRejection('forbidden', 403);
          const errorDetails = debugAuth(req, 403, 'Forbidden');
          return res.status(errorDetails.code).send(errorDetails.message);
        }
        getMetrics()?.authFailures.inc({ reason: authFailureReason(authResult.error) });
        logAuthRejection(authFailureReason(authResult.error), 401);
        const errorDetails = debugAuth(req, 401, 'Unauthorized');
        const wwwAuth = buildWwwAuthenticateHeader(req, {
          errorReason: authResult.error ? 'invalid_token' : undefined,
          isTokenDecrypted: authResult.isTokenDecrypted,
        });
        res.setHeader('WWW-Authenticate', wwwAuth);
        return res.status(errorDetails.code).send(errorDetails.message);
      }

      // Add authentication information to request for use in application
      const normalizedAuth = normalizeAuthPrincipal(authResult);
      if (!normalizedAuth.success) {
        getMetrics()?.authFailures.inc({ reason: authFailureReason(normalizedAuth.error) });
        logAuthRejection(authFailureReason(normalizedAuth.error), 401);
        const errorDetails = debugAuth(req, 401, 'Unauthorized');
        res.setHeader('WWW-Authenticate', buildWwwAuthenticateHeader(req, { errorReason: 'invalid_token' }));
        return res.status(errorDetails.code).send(errorDetails.message);
      }
      (req as any).authInfo = normalizedAuth;
      // Bridge for SDK transports: `StreamableHTTPServerTransport` reads `req.auth` and surfaces it
      // to handlers as `extra.authInfo`. Keep `payload` so `createMcpServer` can pass it downstream.
      (req as any).auth = normalizedAuth;
      return next();
    } catch {
      logAuthRejection('internal_error', 500);
      res.status(500).send('Authentication error');
      return;
    }
  };
}

// Static property for logging tracking
(createAuthMW as any)._logged = false;
