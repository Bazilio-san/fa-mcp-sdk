/**
 * Multi-authentication system core
 */

import { Request } from 'express';
import { checkToken } from './jwt-validation.js';
import { logger as lgr } from '../logger.js';
import { AuthDetectionResult, AuthResult, AuthType } from './types.js';
import { CustomAuthValidator } from '../_types_/types.js';
import { normalizeHeaders } from '../utils/utils.js';
import chalk from 'chalk';
import { appConfig } from '../bootstrap/init-config.js';

const logger = lgr.getSubLogger({ name: chalk.magenta('multi-auth') });

const {
  enabled: authEnabled,
  permanentServerTokens: pt,
  basic: { username: bUsername, password: bPassword } = {},
  jwtToken: { encryptKey } = {},
} = appConfig.webServer?.auth || {};

/**
 * Authentication check order in ascending CPU load
 */
const authOrder = {
  'permanentServerTokens': 1,  // O(1) Set.has()
  'basic': 2,                  // Base64 decoding
  'jwtToken': 3,               // Symmetric decryption + JSON.parse
};

export const getTokenFromHttpHeader = (req: Request): string => {
  return (req.headers.authorization || '').replace(/^Bearer */, '');
};

/**
 * Gets custom auth validator from global context
 */
function getCustomAuthValidator (): CustomAuthValidator | undefined {
  const projectData = (global as any).__MCP_PROJECT_DATA__;
  const fn = projectData?.customAuthValidator;
  return typeof fn === 'function' ? fn : undefined;
}

/**
 * Detects configured authentication types in priority order (ascending CPU load)
 */
export function detectAuthConfiguration (): AuthDetectionResult {
  const configured: AuthType[] = [];
  const errors: Record<string, string[]> = {};
  const result: AuthDetectionResult = { configured, errors };

  if (!authEnabled) {
    return result;
  }
  // Check permanentServerTokens
  if (Array.isArray(pt) && pt.filter(Boolean)) {
    configured.push('permanentServerTokens');
  }

  // Check JWT Token
  if (encryptKey?.length) {
    configured.push('jwtToken');
  }

  // Check Basic Auth
  if (bUsername || bPassword) {
    const errs = [];
    // Default validation - require both username and password
    if (!bUsername) {
      errs.push('Username missing');
    }
    if (!bPassword) {
      errs.push('Password missing');
    }
    if (!errs.length) {
      configured.push('basic');
    } else {
      errors.basic = errs;
    }
  }

  result.configured = configured.sort((a, b) => authOrder[a] - authOrder[b]);
  return result;
}

/**
 * Basic Authentication validation
 */
async function checkBasicAuth (token: string): Promise<AuthResult> {
  const authConfig = appConfig.webServer.auth;
  if (!authConfig.basic) {
    return { success: false, error: 'Basic auth not configured' };
  }

  try {
    // Expecting base64 encoded "username:password"
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [username, password] = decoded.split(':');

    if (!username || !password) {
      return { success: false, error: 'Invalid basic auth format - missing username or password' };
    }

    if (username === bUsername && password === bPassword) {
      return {
        success: true,
        authType: 'basic',
        tokenType: 'basic',
        username,
      };
    }
    return { success: false, error: 'Invalid credentials' };
  } catch {
    return { success: false, error: 'Invalid basic auth format - not valid base64' };
  }
}


/**
 * Checks auth using all configured authentication methods in ascending CPU load order
 */
export async function checkMultiAuth (req: Request): Promise<AuthResult> {
  const token = getTokenFromHttpHeader(req);
  if (!token) {
    return { success: false, error: 'Token not provided' };
  }
  const validAuthTypes = detectAuthConfiguration();
  const { configured } = validAuthTypes;

  if (configured.length) {
    return { success: false, error: 'No authentication methods configured' };
  }
  const configuredTypes = configured.join(', ');
  logger.debug(`Checking auth types: ${configuredTypes}`);

  for (const authType of configured) {
    try {
      switch (authType) {
        case 'permanentServerTokens':
        case 'jwtToken':
          const result = checkToken({ token });
          if (result.errorReason) {
            return { success: false, error: result.errorReason };
          }
          return {
            success: true,
            authType,
            tokenType: result.inTokenType || 'unknown',
            payload: result.payload,
          };

        case 'basic':
          return await checkBasicAuth(token);

        default:
          return { success: false, error: `Unknown auth type: ${authType}` };
      }
    } catch (error) {
      logger.warn(`Auth type ${authType} failed with exception:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  return {
    success: false,
    error: `Authentication failed for all configured methods: ${configuredTypes}`,
  };
}

/**
 * Enhanced authentication check that combines configured auth methods with custom validator
 */
export async function checkCombinedAuth (req: Request): Promise<AuthResult> {
  const { configured } = detectAuthConfiguration();
  const customValidator = getCustomAuthValidator();

  // Create request object with normalized headers for custom validator
  const requestWithNormalizedHeaders = customValidator ? {
    ...req,
    headers: normalizeHeaders(req.headers || {}),
  } : req;

  // If configured auth methods exist, check them first
  if (configured.length) {
    const multiAuthResult = await checkMultiAuth(req);
    if (multiAuthResult.success) {
      // If custom validator also exists, run it additionally
      if (customValidator) {
        try {
          const customResult = await customValidator(requestWithNormalizedHeaders);
          if (!customResult.success) {
            logger.debug(`Standard auth passed but custom validator rejected: ${customResult.error}`);
            return { success: false, error: customResult.error || 'Custom authentication failed' };
          }
          logger.debug('Both standard auth and custom validator passed');

          // Merge authentication results (prefer custom validator details if present)
          return { ...multiAuthResult, ...customResult };
        } catch (error) {
          logger.error('Custom auth validator failed:', error);
          return { success: false, error: 'Custom authentication validation failed' };
        }
      }
      return multiAuthResult;
    }
  }

  // If standard auth failed or no standard auth configured, try custom validator alone
  if (customValidator) {
    try {
      const customResult = await customValidator(requestWithNormalizedHeaders);
      if (customResult.success) {
        logger.debug('Authentication successful using custom validator only');
        return customResult;
      }
      logger.debug(`Custom validator rejected authentication: ${customResult.error}`);
    } catch (error) {
      logger.error('Custom auth validator failed:', error);
      return { success: false, error: 'Custom authentication validation failed' };
    }
  }

  // Both standard and custom auth failed
  const errorMsg = configured.length
    ? `Authentication failed for all methods: ${configured.join(', ')}${customValidator ? ' and custom validator' : ''}`
    : 'No authentication methods configured';

  return { success: false, error: errorMsg };
}

/**
 * Logs authentication configuration (for debugging)
 */
export function logAuthConfiguration (): void {
  const { configured, errors } = detectAuthConfiguration();

  logger.info('Auth system configuration:');
  logger.info(`- enabled: ${!!appConfig.webServer?.auth?.enabled}`);
  logger.info(`- configured types: ${configured.join(', ')}`);

  if (Object.keys(errors).length) {
    logger.warn('Auth configuration errors:');
    Object.entries(errors).forEach(([type, errors]) => {
      logger.warn(`- ${type}: ${errors.join(', ')}`);
    });
  }
}
