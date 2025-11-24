// noinspection UnnecessaryLocalVariableJS
import { NextFunction, Request, Response } from 'express';
import { cyan, lBlue, magenta, red, reset } from 'af-color';
import { checkToken } from './token-core.js';
import { debugTokenAuth } from '../debug.js';
import { appConfig } from '../bootstrap/init-config.js';
import { getResourcesList } from '../mcp/resources.js';
import { getPromptsList } from '../mcp/prompts.js';

const { enabled } = appConfig.webServer.auth;

const getTokenFromHttpHeader = (req: Request): string => {
  return (req.headers.authorization || '').replace(/^Bearer */, '');
};

const SHOW_HEADERS_SET = new Set(['user', 'authorization', 'x-real-ip', 'x-mode', 'host']);

export const debugAuth = (req: Request, code: number, message: string): { code: number, message: string } => {
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
export const isPublicResource = (uri: string): boolean => {
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
export const isPublicPrompt = (name: string): boolean => {
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
export const isPublicMcpRequest = (req: Request): boolean => {
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
