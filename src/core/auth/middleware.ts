// noinspection UnnecessaryLocalVariableJS
import { cyan, lBlue, magenta, red, reset } from 'af-color';
import { NextFunction, Request, Response } from 'express';

import { appConfig } from '../bootstrap/init-config.js';
import { debugTokenAuth } from '../debug.js';
import { getMetrics } from '../metrics/metrics.js';
import { getPromptsList } from '../mcp/prompts.js';
import { getResourcesList } from '../mcp/resources.js';
import { buildWwwAuthenticateHeader } from '../web/oauth-router.js';

import { checkMultiAuth, logAuthConfiguration } from './multi-auth.js';
import { AuthResult } from './types.js';

const { enabled: authEnabled } = appConfig.webServer.auth;

const SHOW_HEADERS_SET = new Set(['user', 'authorization', 'x-real-ip', 'x-mode', 'host']);

const debugAuth = (req: Request, code: number, message: string): { code: number; message: string } => {
  if (debugTokenAuth.enabled) {
    let headersStr: string = '';
    if (req.headers) {
      headersStr = Object.entries(req.headers)
        .map(([k, v]) => {
          if (SHOW_HEADERS_SET.has(k.toLowerCase())) {
            return `${cyan}${k}${lBlue}: ${magenta}${v}${reset}`;
          }
          return undefined;
        })
        .filter(Boolean)
        .join(', ');
    }
    debugTokenAuth(`${red}Unauthorized ${lBlue}${code}${red} ${message}${reset} Headers: ${headersStr || '-'}`);
  }
  return { code, message };
};

// Legacy functions removed - use createAuthMW() instead

/**
 * Check if a resource URI is public (doesn't require authentication)
 */
const isPublicResource = async (uri: string): Promise<boolean> => {
  // Get all resources including built-in and custom
  const { resources: allResources } = await getResourcesList({ transport: 'http' });
  const resource = allResources.find((r) => r.uri === uri);

  if (!resource) {
    return false; // Unknown resources require auth by default
  }

  return resource.requireAuth !== true;
};

/**
 * Check if a prompt name is public (doesn't require authentication)
 */
const isPublicPrompt = async (name: string): Promise<boolean> => {
  // Get all prompts including built-in and custom
  const { prompts: allPrompts } = await getPromptsList({ transport: 'http' });
  const prompt = allPrompts.find((p) => p.name === name);

  if (!prompt) {
    return false; // Unknown prompts require auth by default
  }

  return (prompt as any).requireAuth !== true;
};

/**
 * Check if the current MCP request is for a public resource or prompt
 */
const isPublicMcpRequest = async (req: Request): Promise<boolean> => {
  const { method } = req.body || {};

  switch (method) {
    case 'ping':
    case 'initialize':
    case 'notifications/initialized':
    case 'tools/list':
    case 'prompts/list':
    case 'resources/list':
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

/**
 * Standard §7.5 — verify the bearer token carries every scope required by the target
 * resource / prompt. Returns the missing scopes (empty array when OK).
 */
function checkScopes(required: string[] | undefined, payload: any): string[] {
  if (!Array.isArray(required) || required.length === 0) {
    return [];
  }
  const tokenScopes = String(payload?.scope ?? '')
    .split(/\s+/)
    .filter(Boolean);
  return required.filter((s) => !tokenScopes.includes(s));
}

/**
 * Map the MCP method on a successful auth result to a required-scopes list, then verify
 * the token carries them. Returns an `AuthResult.forbidden` shape when scopes are missing.
 */
async function enforceScopes(
  req: Request,
  authResult: { success: true; payload?: any },
): Promise<{ forbidden: true; error: string } | undefined> {
  const { method } = req.body || {};
  let required: string[] | undefined;
  if (method === 'resources/read') {
    const uri = req.body?.params?.uri;
    if (uri) {
      const { resources } = await getResourcesList({ transport: 'http' });
      required = (resources.find((r) => r.uri === uri) as any)?.requiredScopes;
    }
  } else if (method === 'prompts/get') {
    const name = req.body?.params?.name;
    if (name) {
      const { prompts } = await getPromptsList({ transport: 'http' });
      required = (prompts.find((p) => p.name === name) as any)?.requiredScopes;
    }
  }
  const missing = checkScopes(required, authResult.payload);
  if (missing.length > 0) {
    return { forbidden: true, error: `Missing scopes: ${missing.join(',')}` };
  }
  return undefined;
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
    return debugAuth(req, 401, authResult.error || 'Authentication failed');
  }

  // Add authentication information to request for use in application
  (req as any).authInfo = { ...authResult };
  (req as any).auth = { ...authResult }; // SDK transport bridge — see createAuthMW

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
      return next();
    }

    // Log configuration on first request
    if (logConfig && !(createAuthMW as any)._logged) {
      logAuthConfiguration();
      (createAuthMW as any)._logged = true;
    }

    // Check if this is a public MCP request on any of the configured paths
    const isMcpRequest = mcpPaths.includes(req.path);
    if (isMcpRequest && (await isPublicMcpRequest(req))) {
      return next();
    }

    // Skip authentication if disabled
    if (!authEnabled) {
      return next();
    }

    try {
      // Use enhanced combined authentication (standard + custom validator)
      const authResult: AuthResult = await checkMultiAuth(req);
      if (!authResult.success) {
        // Standard §7.4 — forbidden (authenticated but lacking permission) → 403, NO WWW-Authenticate.
        if (authResult.forbidden) {
          getMetrics()?.authFailures.inc({ reason: 'forbidden' });
          const errorDetails = debugAuth(req, 403, authResult.error || 'Forbidden');
          return res.status(errorDetails.code).send(errorDetails.message);
        }
        const reason = (authResult.error ?? 'unauthorized').slice(0, 64);
        getMetrics()?.authFailures.inc({ reason });
        const errorDetails = debugAuth(req, 401, authResult.error || 'Authentication failed');
        const wwwAuth = buildWwwAuthenticateHeader(req, {
          errorReason: authResult.error,
          isTokenDecrypted: authResult.isTokenDecrypted,
        });
        res.setHeader('WWW-Authenticate', wwwAuth);
        return res.status(errorDetails.code).send(errorDetails.message);
      }

      // Standard §7.5 — scope enforcement against the target resource / prompt.
      const scopeViolation = await enforceScopes(req, authResult as any);
      if (scopeViolation) {
        getMetrics()?.authFailures.inc({ reason: 'missing_scope' });
        const errorDetails = debugAuth(req, 403, scopeViolation.error);
        return res.status(errorDetails.code).send(errorDetails.message);
      }

      // Add authentication information to request for use in application
      (req as any).authInfo = authResult;
      // Bridge for SDK transports: `StreamableHTTPServerTransport` reads `req.auth` and surfaces it
      // to handlers as `extra.authInfo`. Keep `payload` so `createMcpServer` can pass it downstream.
      (req as any).auth = authResult;
      return next();
    } catch {
      res.status(500).send('Authentication error');
      return;
    }
  };
}

// Static property for logging tracking
(createAuthMW as any)._logged = false;
