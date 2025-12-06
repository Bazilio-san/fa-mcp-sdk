// noinspection UnnecessaryLocalVariableJS
import { NextFunction, Request, Response } from 'express';
import { cyan, lBlue, magenta, red, reset } from 'af-color';
import { checkToken } from './jwt-validation.js';
import { debugTokenAuth } from '../debug.js';
import { appConfig } from '../bootstrap/init-config.js';
import { getResourcesList } from '../mcp/resources.js';
import { getPromptsList } from '../mcp/prompts.js';

const { enabled } = appConfig.webServer.auth;

const getTokenFromHttpHeader = (req: Request): string => {
  return (req.headers.authorization || '').replace(/^Bearer */, '');
};

const SHOW_HEADERS_SET = new Set(['user', 'authorization', 'x-real-ip', 'x-mode', 'host']);

const debugAuth = (req: Request, code: number, message: string): { code: number, message: string } => {
  if (debugTokenAuth.enabled) {
    let headersStr: string = '';
    if (req.headers) {
      headersStr = Object.entries(req.headers).map(([k, v]) => {
        if (SHOW_HEADERS_SET.has(k.toLowerCase())) {
          return `${cyan}${k}${lBlue}: ${magenta}${v}${reset}`;
        }
        return undefined;
      }).filter(Boolean).join(', ');
    }
    debugTokenAuth(`${red}Unauthorized ${lBlue}${code}${red} ${message}${reset} Headers: ${headersStr || '-'}`);
  }
  return { code, message };
};


/**
 * Checks token authorization.
 * If everything is OK, it will return undefined.
 * Otherwise, it will return the object with an error
 */
export const getAuthByTokenError = (req: Request): { code: number, message: string } | undefined => {
  if (!enabled) {
    return undefined;
  }
  const token = getTokenFromHttpHeader(req);
  if (!token) {
    return debugAuth(req, 400, 'Missing authorization header');
  }
  const checkResult = checkToken({ token });
  if (checkResult.errorReason) {
    return debugAuth(req, 401, checkResult.errorReason);
  }
  return undefined;
};

export const authByToken = (req: Request, res: Response) => {
  const authError = getAuthByTokenError(req);
  if (authError) {
    res.status(authError.code).send(authError.message);
    return false;
  }
  return true;
};

/**
 * Check if a resource URI is public (doesn't require authentication)
 */
const isPublicResource = (uri: string): boolean => {
  // Get all resources including built-in and custom
  const allResources = getResourcesList().resources;
  const resource = allResources.find(r => r.uri === uri);

  if (!resource) {
    return false; // Unknown resources require auth by default
  }

  // Check if resource explicitly sets requireAuth to false (undefined means true for custom resources)
  return (resource as any).requireAuth === false;
};

/**
 * Check if a prompt name is public (doesn't require authentication)
 */
const isPublicPrompt = (name: string): boolean => {
  // Get all prompts including built-in and custom
  const allPrompts = getPromptsList().prompts;
  const prompt = allPrompts.find(p => p.name === name);

  if (!prompt) {
    return false; // Unknown prompts require auth by default
  }

  // Check if prompt explicitly sets requireAuth to false (undefined means true for custom prompts)
  return (prompt as any).requireAuth === false;
};

/**
 * Check if the current MCP request is for a public resource or prompt
 */
const isPublicMcpRequest = (req: Request): boolean => {
  const { method } = req.body || {};

  switch (method) {
    case 'resources/list':
      // Resources list is always public
      return true;

    case 'resources/read': {
      const uri = req.body?.params?.uri;
      return uri ? isPublicResource(uri) : false;
    }

    case 'prompts/list':
      // Prompts list is always public
      return true;

    case 'prompts/get': {
      const name = req.body?.params?.name;
      return name ? isPublicPrompt(name) : false;
    }

    default:
      // All other methods require authentication
      return false;
  }
};

/**
 * Create conditional auth middleware that checks for public MCP requests
 */
export const createConditionalAuthMiddleware = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Check if this is an MCP request (HTTP or SSE) that should be public
    const isMcpRequest = req.path === '/mcp' || req.path === '/messages' || req.path === '/sse';

    if (isMcpRequest && isPublicMcpRequest(req)) {
      return next();
    }

    const authError = getAuthByTokenError(req);
    if (authError) {
      res.status(authError.code).send(authError.message);
      return;
    }
    next();
  };
};

export const authTokenMW = (req: Request, res: Response, next: NextFunction) => {
  // Check if this is a public MCP request
  if (req.path === '/mcp' && isPublicMcpRequest(req)) {
    return next();
  }

  const authError = getAuthByTokenError(req);
  if (authError) {
    res.status(authError.code).send(authError.message);
    return;
  }
  next();
};

// ========================================================================
// MULTI-AUTHENTICATION - NEW FUNCTIONALITY
// ========================================================================

import { checkMultiAuth, detectAuthConfiguration, logAuthConfiguration } from './multi-auth.js';

/**
 * Checks token authorization using all configured methods
 * in ascending CPU load order
 */
export const getMultiAuthError = (req: Request): { code: number, message: string } | undefined => {
  const { auth } = appConfig.webServer;
  if (!auth.enabled) {
    return undefined;
  }

  const token = getTokenFromHttpHeader(req);
  if (!token) {
    return debugAuth(req, 400, 'Missing authorization header');
  }

  const authResult = checkMultiAuth(token, auth);
  if (!authResult.success) {
    return debugAuth(req, 401, authResult.error || 'Authentication failed');
  }

  // Add authentication information to request for use in application
  (req as any).authInfo = {
    authType: authResult.authType,
    tokenType: authResult.tokenType,
    username: authResult.username,
    accessToken: authResult.accessToken,
    payload: authResult.payload
  };

  return undefined;
};

/**
 * Determines whether to use multi-authentication or basic JWT is sufficient
 */
function shouldUseMultiAuth (auth: typeof appConfig.webServer.auth): boolean {
  return !!(auth.pat || auth.basic || auth.oauth2);
}

/**
 * Enhanced middleware with multi-authentication support
 * Automatically determines which system to use
 */
export const enhancedAuthTokenMW = (req: Request, res: Response, next: NextFunction) => {
  // Check if this is a public MCP request
  if (req.path === '/mcp' && isPublicMcpRequest(req)) {
    return next();
  }

  const auth = appConfig.webServer.auth;

  // If additional authentication types are configured - use multi-auth
  const authError = shouldUseMultiAuth(auth)
    ? getMultiAuthError(req)      // 🆕 New system
    : getAuthByTokenError(req);   // ✅ Existing system

  if (authError) {
    res.status(authError.code).send(authError.message);
    return;
  }
  next();
};

/**
 * Middleware configurator - creates middleware with specified options
 */
export function createConfigurableAuthMiddleware (options: {
  forceMultiAuth?: boolean;
  logConfiguration?: boolean;
} = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = appConfig.webServer.auth;

    // Log configuration on first request
    if (options.logConfiguration && !(createConfigurableAuthMiddleware as any)._logged) {
      logAuthConfiguration(auth);
      (createConfigurableAuthMiddleware as any)._logged = true;
    }

    // Check if this is a public MCP request
    if (req.path === '/mcp' && isPublicMcpRequest(req)) {
      return next();
    }

    // Choose authentication system
    const useMultiAuth = options.forceMultiAuth || shouldUseMultiAuth(auth);
    const authError = useMultiAuth
      ? getMultiAuthError(req)
      : getAuthByTokenError(req);

    if (authError) {
      res.status(authError.code).send(authError.message);
      return;
    }
    next();
  };
}

// Static property for logging tracking
(createConfigurableAuthMiddleware as any)._logged = false;

/**
 * Utility to get current authentication configuration information
 */
export function getAuthInfo () {
  const auth = appConfig.webServer.auth;
  const detection = detectAuthConfiguration(auth);

  return {
    enabled: auth.enabled,
    configured: detection.configured,
    valid: detection.valid,
    errors: detection.errors,
    usingMultiAuth: shouldUseMultiAuth(auth)
  };
}
