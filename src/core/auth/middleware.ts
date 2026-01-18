// noinspection UnnecessaryLocalVariableJS
import { NextFunction, Request, Response } from 'express';
import { cyan, lBlue, magenta, red, reset } from 'af-color';
import { debugTokenAuth } from '../debug.js';
import { appConfig } from '../bootstrap/init-config.js';
import { getResourcesList } from '../mcp/resources.js';
import { getPromptsList } from '../mcp/prompts.js';
import { checkMultiAuth, logAuthConfiguration } from './multi-auth.js';
import { AuthResult } from './types.js';


const { enabled: authEnabled } = appConfig.webServer.auth;

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


// Legacy functions removed - use createAuthMW() instead

/**
 * Check if a resource URI is public (doesn't require authentication)
 */
const isPublicResource = async (uri: string): Promise<boolean> => {
  // Get all resources including built-in and custom
  const { resources: allResources } = await getResourcesList({ transport: 'http' });
  const resource = allResources.find(r => r.uri === uri);

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
  const prompt = allPrompts.find(p => p.name === name);

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

// Legacy middleware functions removed - use createAuthMW() instead

/**
 * Programmatic authentication checking - for manual auth validation in code
 * Returns error object if authentication failed, undefined if successful
 */
export const getMultiAuthError = async (req: Request): Promise<{ code: number, message: string } | undefined> => {
  if (!authEnabled) {
    return undefined;
  }

  const authResult = await checkMultiAuth(req);
  if (!authResult.success) {
    return debugAuth(req, 401, authResult.error || 'Authentication failed');
  }

  // Add authentication information to request for use in application
  (req as any).authInfo = { ...authResult };

  return undefined;
};

// ========================================================================
// UNIVERSAL AUTHENTICATION MIDDLEWARE
// ========================================================================

interface AuthMiddlewareOptions {
  mcpPaths?: string[];        // Paths to check for public MCP requests (default: ['/mcp', '/messages', '/sse'])
  logConfig?: boolean;        // Log auth configuration on first request (default: from LOG_AUTH_CONFIG env)
}

/**
 * Universal authentication middleware - handles all authentication scenarios
 */
export function createAuthMW (options: AuthMiddlewareOptions = {}) {
  const {
    mcpPaths = ['/mcp', '/messages', '/sse'],
    logConfig = process.env.LOG_AUTH_CONFIG === 'true',
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Log configuration on first request
    if (logConfig && !(createAuthMW as any)._logged) {
      logAuthConfiguration();
      (createAuthMW as any)._logged = true;
    }

    // Check if this is a public MCP request on any of the configured paths
    const isMcpRequest = mcpPaths.includes(req.path);
    if (isMcpRequest && await isPublicMcpRequest(req)) {
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
        const errorDetails = debugAuth(req, 401, authResult.error || 'Authentication failed');
        return res.status(errorDetails.code).send(errorDetails.message);
      }

      // Add authentication information to request for use in application
      (req as any).authInfo = authResult;
      return next();
    } catch {
      res.status(500).send('Authentication error');
      return;
    }
  };
}

// Static property for logging tracking
(createAuthMW as any)._logged = false;

