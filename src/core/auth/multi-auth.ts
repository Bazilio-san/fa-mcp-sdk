/**
 * Multi-authentication system core
 */

import { checkToken } from './jwt-validation.js';
import { AppConfig } from '../_types_/config.js';
import { logger as lgr } from '../logger.js';
import { AuthDetectionResult, AuthResult, AuthType } from './types.js';
import { CustomBasicAuthValidator } from '../_types_/types.js';
import chalk from 'chalk';

const logger = lgr.getSubLogger({ name: chalk.magenta('multi-auth') });

/**
 * Authentication check order in ascending CPU load
 */
const AUTH_PRIORITY_ORDER: Record<AuthType, number> = {
  'permanentServerTokens': 1,  // O(1) Set.has()
  'pat': 2,                    // String and length validation
  'basic': 3,                  // Base64 decoding
  'jwtToken': 4,               // Symmetric decryption + JSON.parse
  'oauth2': 5,                 // Potentially HTTP requests
};

/**
 * Gets custom basic auth validator from global context
 */
function getCustomBasicAuthValidator (): CustomBasicAuthValidator | undefined {
  const projectData = (global as any).__MCP_PROJECT_DATA__;
  const fn = projectData?.customBasicAuthValidator;
  return typeof fn === 'function' ? fn : undefined;
}

/**
 * Detects configured authentication types
 */
export function detectAuthConfiguration (authConfig: AppConfig['webServer']['auth']): AuthDetectionResult {
  const configured: AuthType[] = [];
  const valid: AuthType[] = [];
  const errors: Record<string, string[]> = {};
  const result: AuthDetectionResult = {
    configured,
    valid,
    errors,
  };

  const { enabled, basic, jwtToken: { encryptKey } = {}, oauth2, pat, permanentServerTokens: pt } = authConfig;

  if (!enabled) {
    return result;
  }
  // Check permanentServerTokens
  if (Array.isArray(pt) && pt.filter(Boolean)) {
    configured.push('permanentServerTokens');
    valid.push('permanentServerTokens');
  }

  // Check JWT Token
  if (encryptKey?.length) {
    configured.push('jwtToken');
    valid.push('jwtToken');
  }

  // Check PAT
  if (pat?.length) {
    if (pat.length > 10) {
      configured.push('pat');
      valid.push('pat');
    } else {
      errors.pat = ['Token too short or invalid'];
    }
  }

  // Check Basic Auth
  if (basic && (basic.username || basic.password)) {
    configured.push('basic');
    const errs = [];
    const customValidator = getCustomBasicAuthValidator();

    // If custom validator exists, we only need it to be configured (no username/password check)
    if (customValidator) {
      valid.push('basic');
    } else {
      // Default validation - require both username and password
      if (!basic.username) {
        errs.push('Username missing');
      }
      if (!basic.password) {
        errs.push('Password missing');
      }

      if (!errs.length) {
        valid.push('basic');
      } else {
        errors.basic = errs;
      }
    }
  }

  // Check OAuth2
  const { clientId, clientSecret, accessToken } = oauth2 || {};
  if (clientId || clientSecret || accessToken) {
    configured.push('oauth2');
    const required = ['clientId', 'clientSecret', 'accessToken'];
    const missing = required.filter((field) => !oauth2![field as keyof typeof oauth2]);

    if (missing.length) {
      errors.oauth2 = [`Missing fields: ${missing.join(', ')}`];
    } else {
      valid.push('oauth2');
    }
  }

  return result;
}

/**
 * Gets list of valid authorization types in priority order (ascending CPU load)
 */
export function getValidAuthTypes (authConfig: AppConfig['webServer']['auth']): AuthType[] {
  const detection = detectAuthConfiguration(authConfig);

  return detection.valid.sort((a, b) => {
    return AUTH_PRIORITY_ORDER[a] - AUTH_PRIORITY_ORDER[b];
  });
}

/**
 * Checks token for specific authentication type
 */
export async function checkAuthType (
  authType: AuthType,
  token: string,
  authConfig: AppConfig['webServer']['auth'],
): Promise<AuthResult> {
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

      case 'pat':
        return checkPATToken(token);

      case 'basic':
        return await checkBasicAuth(token, authConfig);

      case 'oauth2':
        return checkOAuth2Token(token, authConfig);

      default:
        return { success: false, error: `Unknown auth type: ${authType}` };
    }
  } catch (error) {
    logger.error(`Auth type ${authType} check failed:`, error);
    return { success: false, error: `${authType} validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

/**
 * PAT (Personal Access Token) validation
 */
function checkPATToken (token: any): AuthResult {
  // Simple Atlassian PAT token format validation
  if (!token || typeof token !== 'string') {
    return { success: false, error: 'PAT token must be a string' };
  }

  // Also support other PAT token formats
  if (token.length >= 20 && /^[A-Za-z0-9+/=_-]+$/.test(token)) {
    return {
      success: true,
      authType: 'pat',
      tokenType: 'pat',
      accessToken: token,
    };
  }

  return { success: false, error: 'Invalid PAT token format' };
}

/**
 * Basic Authentication validation
 */
async function checkBasicAuth (token: string, authConfig: AppConfig['webServer']['auth']): Promise<AuthResult> {
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

    const customValidator = getCustomBasicAuthValidator();

    if (customValidator) {
      // Use custom validation function
      try {
        const isValid = await customValidator(username, password);
        if (isValid) {
          return {
            success: true,
            authType: 'basic',
            tokenType: 'basic',
            username,
          };
        } else {
          return { success: false, error: 'Invalid credentials' };
        }
      } catch (error) {
        logger.error('Custom basic auth validator failed:', error);
        return { success: false, error: 'Authentication validation failed' };
      }
    } else {
      // Default validation using configured username/password
      if (username === authConfig.basic.username && password === authConfig.basic.password) {
        return {
          success: true,
          authType: 'basic',
          tokenType: 'basic',
          username,
        };
      }
      return { success: false, error: 'Invalid credentials' };
    }
  } catch {
    return { success: false, error: 'Invalid basic auth format - not valid base64' };
  }
}

/**
 * OAuth2 token validation
 */
function checkOAuth2Token (token: string, authConfig: AppConfig['webServer']['auth']): AuthResult {
  if (!authConfig.oauth2) {
    return { success: false, error: 'OAuth2 not configured' };
  }

  try {
    // Check Bearer token format
    if (!token.startsWith('Bearer ')) {
      return { success: false, error: 'OAuth2 token must start with Bearer' };
    }

    const accessToken = token.replace('Bearer ', '');

    // Simple check that token is not empty and has reasonable length
    if (accessToken.length < 10) {
      return { success: false, error: 'OAuth2 token too short' };
    }

    // Simple token format validation
    if (!/^[A-Za-z0-9+/=_.-]+$/.test(accessToken)) {
      return { success: false, error: 'Invalid OAuth2 token format' };
    }

    // In real implementation there would be token validation through API
    // or validation through introspection endpoint

    return {
      success: true,
      authType: 'oauth2',
      tokenType: 'oauth2',
      accessToken,
    };
  } catch (error) {
    return { success: false, error: `OAuth2 validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

/**
 * Checks token using all configured authentication methods
 * in ascending CPU load order
 */
export async function checkMultiAuth (
  token: string,
  authConfig: AppConfig['webServer']['auth'],
): Promise<AuthResult> {
  if (!token) {
    return { success: false, error: 'Token not provided' };
  }

  const validAuthTypes = getValidAuthTypes(authConfig);

  if (validAuthTypes.length === 0) {
    return { success: false, error: 'No authentication methods configured' };
  }

  logger.debug(`Checking token with auth types: ${validAuthTypes.join(', ')}`);

  for (const authType of validAuthTypes) {
    try {
      const result = await checkAuthType(authType, token, authConfig);
      if (result.success) {
        logger.debug(`Authentication successful using: ${authType}`);
        return result;
      }
      logger.debug(`Authentication failed for ${authType}: ${result.error}`);
    } catch (error) {
      logger.warn(`Auth type ${authType} failed with exception:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  return {
    success: false,
    error: `Authentication failed for all configured methods: ${validAuthTypes.join(', ')}`,
  };
}

/**
 * Logs authentication configuration (for debugging)
 */
export function logAuthConfiguration (authConfig: AppConfig['webServer']['auth']): void {
  const detection = detectAuthConfiguration(authConfig);

  logger.info('Auth system configuration:');
  logger.info(`- enabled: ${authConfig.enabled}`);
  logger.info(`- configured types: ${detection.configured.join(', ')}`);
  logger.info(`- valid types: ${detection.valid.join(', ')}`);

  if (Object.keys(detection.errors).length > 0) {
    logger.warn('Auth configuration errors:');
    Object.entries(detection.errors).forEach(([type, errors]) => {
      logger.warn(`- ${type}: ${errors.join(', ')}`);
    });
  }
}
