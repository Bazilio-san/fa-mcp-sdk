/**
 * Admin panel authentication middleware
 * Supports 4 authentication types: permanentServerTokens, basic, jwtToken, ntlm
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import chalk from 'chalk';
import { appConfig } from '../bootstrap/init-config.js';
import { logger as lgr } from '../logger.js';
import { checkPermanentToken } from './permanent.js';
import { checkJwtToken } from './jwt.js';
import { getTokenFromHttpHeader } from './multi-auth.js';
import { setupNTLMAuthentication } from './token-generator/ntlm/ntlm-integration.js';
import { isNTLMEnabled } from './token-generator/ntlm/ntlm-domain-config.js';
import { checkBasicAuth } from './basic.js';

const logger = lgr.getSubLogger({ name: chalk.yellow('admin-auth') });

export type AdminAuthType = 'permanentServerTokens' | 'basic' | 'jwtToken' | 'ntlm';
const { adminAuth, auth } = appConfig.webServer || {};

/**
 * Validates admin auth configuration
 * Returns error message if configuration is invalid, null if valid
 */
export function validateAdminAuthConfig (): string | null {
  if (!adminAuth?.enabled) {
    return null; // Disabled, no validation needed
  }

  const authType = adminAuth.type;

  switch (authType) {
    case 'permanentServerTokens': {
      const tokens = auth?.permanentServerTokens;
      if (!Array.isArray(tokens) || !tokens.filter(Boolean).length) {
        return 'adminAuth type is "permanentServerTokens" but no tokens are configured in webServer.auth.permanentServerTokens';
      }
      break;
    }

    case 'basic': {
      const basic = auth?.basic;
      if (!basic?.username || !basic?.password) {
        return 'adminAuth type is "basic" but username or password is missing in webServer.auth.basic';
      }
      break;
    }

    case 'jwtToken': {
      const jwt = auth?.jwtToken;
      if (!jwt?.encryptKey || jwt.encryptKey.length < 8) {
        return 'adminAuth type is "jwtToken" but encryptKey is missing or too short in webServer.auth.jwtToken';
      }
      break;
    }

    case 'ntlm': {
      // NTLM doesn't require credentials in webServer.auth, just AD config
      // The isNTLMEnabled function checks for AD configuration
      if (!isNTLMEnabled) {
        return 'adminAuth type is "ntlm" but no AD configuration found (ad.domains is empty or missing)';
      }
      break;
    }

    default:
      return `Unknown adminAuth type: ${authType}. Valid types: permanentServerTokens, basic, jwtToken, ntlm`;
  }

  return null;
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

  const authType = adminAuth.type;
  // logger.info(`Admin authentication enabled with type: ${authType}`);

  // For NTLM, use existing NTLM middleware
  if (authType === 'ntlm') {
    return setupNTLMAuthentication();
  }

  // For other auth types, create standard middleware
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
        return sendAuthRequired(res, authType);
      }

      let authResult: { success: boolean; error?: string; username?: string; payload?: any };

      switch (authType) {
        case 'permanentServerTokens': {
          const result = checkPermanentToken(credentials);
          authResult = result.errorReason
            ? { success: false, error: result.errorReason }
            : { success: true, username: 'ServerToken' };
          break;
        }

        case 'basic': {
          if (scheme !== 'basic') {
            return sendAuthRequired(res, authType, 'Basic authentication required');
          }
          authResult = checkBasicAuth(credentials);
          break;
        }

        case 'jwtToken': {
          const result = checkJwtToken({ token: credentials });
          authResult = result.errorReason
            ? { success: false, error: result.errorReason }
            : { success: true, username: result.payload?.user || 'JWT User', payload: result.payload };
          break;
        }

        default:
          authResult = { success: false, error: `Unknown auth type: ${authType}` };
      }

      if (!authResult.success) {
        logger.debug(`Admin auth failed: ${authResult.error}`);
        return sendAuthRequired(res, authType, authResult.error);
      }

      // Set authenticated user info
      req.ntlm = {
        isAuthenticated: true,
        username: authResult.username || 'Authenticated',
        domain: authType,
      };

      if (authResult.payload) {
        (req as any).authPayload = authResult.payload;
      }

      next();
    },
  ];
}

/**
 * Send authentication required response
 */
function sendAuthRequired (res: Response, authType: AdminAuthType, message?: string): void {
  const errorMessage = message || 'Authentication required';

  switch (authType) {
    case 'basic':
      res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
      break;
    case 'permanentServerTokens':
    case 'jwtToken':
      res.setHeader('WWW-Authenticate', 'Bearer realm="Admin Panel"');
      break;
  }

  res.status(401).json({
    success: false,
    error: errorMessage,
  });
}
