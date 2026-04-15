/**
 * Admin panel authentication middleware
 * Supports 4 authentication types: permanentServerTokens, basic, jwtToken, ntlm
 * adminAuth.type accepts a single type or an array of types
 */

import chalk from 'chalk';
import { Request, Response, NextFunction, RequestHandler } from 'express';

import { AdminAuthType } from '../_types_/config.js';
import { appConfig } from '../bootstrap/init-config.js';
import { logger as lgr } from '../logger.js';

import { checkBasicAuth } from './basic.js';
import { checkJwtToken } from './jwt.js';
import { getTokenFromHttpHeader } from './multi-auth.js';
import { checkPermanentToken } from './permanent.js';
import { isNTLMEnabled } from './token-generator/ntlm/ntlm-domain-config.js';
import { setupNTLMAuthentication } from './token-generator/ntlm/ntlm-integration.js';

const logger = lgr.getSubLogger({ name: chalk.yellow('admin-auth') });

export type { AdminAuthType };
const { adminAuth, auth } = appConfig.webServer || {};

/**
 * Normalizes adminAuth.type to an array
 */
export function getAdminAuthTypes (): AdminAuthType[] {
  if (!adminAuth?.type) {return [];}
  return Array.isArray(adminAuth.type) ? adminAuth.type : [adminAuth.type];
}

/**
 * Validates admin auth configuration for a single type
 */
function validateSingleAuthType (authType: AdminAuthType): string | null {
  switch (authType) {
    case 'permanentServerTokens': {
      const tokens = auth?.permanentServerTokens;
      if (!Array.isArray(tokens) || !tokens.filter(Boolean).length) {
        return `adminAuth type "${authType}" but no tokens are configured in webServer.auth.permanentServerTokens`;
      }
      break;
    }

    case 'basic': {
      const basic = auth?.basic;
      if (!basic?.username || !basic?.password) {
        return `adminAuth type "${authType}" but username or password is missing in webServer.auth.basic`;
      }
      break;
    }

    case 'jwtToken': {
      const jwt = auth?.jwtToken;
      if (!jwt?.encryptKey || jwt.encryptKey.length < 8) {
        return `adminAuth type "${authType}" but encryptKey is missing or too short in webServer.auth.jwtToken`;
      }
      break;
    }

    case 'ntlm': {
      if (!isNTLMEnabled) {
        return `adminAuth type "${authType}" but no AD configuration found (ad.domains is empty or missing)`;
      }
      break;
    }

    default:
      return `Unknown adminAuth type: ${authType}. Valid types: permanentServerTokens, basic, jwtToken, ntlm`;
  }

  return null;
}

/**
 * Validates admin auth configuration
 * Returns error message if configuration is invalid, null if valid
 */
export function validateAdminAuthConfig (): string | null {
  if (!adminAuth?.enabled) {
    return null; // Disabled, no validation needed
  }

  const types = getAdminAuthTypes();
  if (types.length === 0) {
    return 'adminAuth is enabled but no type is configured';
  }

  for (const t of types) {
    const error = validateSingleAuthType(t);
    if (error) {return error;}
  }

  return null;
}

/**
 * Returns the list of auth methods available for the admin login UI.
 * Maps auth types to UI categories: 'token' (permanentServerTokens, jwtToken) or 'basic'.
 */
export function getAdminAuthMethods (): string[] {
  if (!adminAuth?.enabled) {return [];}
  const types = getAdminAuthTypes();
  const methods: string[] = [];
  for (const t of types) {
    if (t === 'permanentServerTokens' || t === 'jwtToken') {
      methods.push('token');
    } else if (t === 'basic') {
      methods.push('basic');
    }
    // ntlm is handled by browser-native dialog, not by the login modal
  }
  return [...new Set(methods)];
}

/**
 * Try authenticating a request against a single auth type.
 * Returns auth result or null if this type doesn't match the request.
 */
function tryAuthType (
  authType: AdminAuthType,
  scheme: string,
  credentials: string,
): { success: boolean; error?: string; username?: string; payload?: any } | null {
  switch (authType) {
    case 'permanentServerTokens': {
      if (scheme === 'basic') {return null;} // Not a bearer/token
      const result = checkPermanentToken(credentials);
      return result.errorReason
        ? { success: false, error: result.errorReason }
        : { success: true, username: 'ServerToken' };
    }

    case 'basic': {
      if (scheme !== 'basic') {return null;} // Not basic auth
      return checkBasicAuth(credentials);
    }

    case 'jwtToken': {
      if (scheme === 'basic') {return null;} // Not a bearer/token
      const result = checkJwtToken({ token: credentials });
      if (result.errorReason) {
        return { success: false, error: result.errorReason };
      }
      if (result.payload?.allow !== 'gen-token') {
        return { success: false, error: 'Admin panel requires JWT token with payload.allow === "gen-token"' };
      }
      return { success: true, username: result.payload?.user || 'JWT User', payload: result.payload };
    }

    default:
      return null;
  }
}

/**
 * Creates admin authentication middleware based on adminAuth.type config
 */
export function createAdminAuthMW (): RequestHandler[] {
  // If admin auth is disabled, return pass-through middleware
  if (!adminAuth?.enabled) {
    logger.info('Admin authentication is DISABLED');
    return [(req: Request, res: Response, next: NextFunction) => {
      // Set anonymous user info for compatibility
      req.ntlm = {
        isAuthenticated: false,
        username: 'Anonymous',
        domain: 'NoAuth',
      };
      next();
    }];
  }

  const types = getAdminAuthTypes();

  // If the only type is NTLM, use existing NTLM middleware
  if (types.length === 1 && types[0] === 'ntlm') {
    return setupNTLMAuthentication();
  }

  // Filter out ntlm from the types that can be handled by the standard middleware
  const standardTypes = types.filter((t) => t !== 'ntlm');

  // For standard auth types, create middleware
  return [
    (req: Request, res: Response, next: NextFunction) => {
      // Set default NTLM info for compatibility with token-generator templates
      req.ntlm = {
        isAuthenticated: false,
        username: 'Unknown',
        domain: 'Unknown',
      };

      const { scheme, credentials } = getTokenFromHttpHeader(req);

      // If no credentials provided, request authentication
      if (!credentials) {
        return sendAuthRequired(res, standardTypes);
      }

      // Try each configured auth type in order
      for (const authType of standardTypes) {
        const result = tryAuthType(authType, scheme || '', credentials);
        if (result && result.success) {
          req.ntlm = {
            isAuthenticated: true,
            username: result.username || 'Authenticated',
            domain: authType,
          };
          if (result.payload) {
            (req as any).authPayload = result.payload;
          }
          return next();
        }
      }

      logger.debug('Admin auth failed: no matching auth type');
      return sendAuthRequired(res, standardTypes, 'Authentication failed');
    },
  ];
}

/**
 * Send authentication required response
 */
function sendAuthRequired (res: Response, authTypes: AdminAuthType[], message?: string): void {
  const errorMessage = message || 'Authentication required';

  const hasBasic = authTypes.includes('basic');
  const hasBearer = authTypes.includes('permanentServerTokens') || authTypes.includes('jwtToken');

  // Set WWW-Authenticate headers for each supported scheme
  const challenges: string[] = [];
  if (hasBearer) {
    challenges.push('Bearer realm="Admin Panel"');
  }
  if (hasBasic) {
    challenges.push('Basic realm="Admin Panel"');
  }
  if (challenges.length) {
    res.setHeader('WWW-Authenticate', challenges.join(', '));
  }

  res.status(401).json({
    success: false,
    error: errorMessage,
  });
}
