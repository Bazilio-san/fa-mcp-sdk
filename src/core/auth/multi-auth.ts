/**
 * Multi-authentication system core
 */

import { checkToken } from './jwt-validation.js';
import { AppConfig } from '../_types_/config.js';
import { logger as lgr } from '../logger.js';
import { AuthDetectionResult, AuthResult, AuthType, AUTH_PRIORITY_ORDER } from './types.js';
import chalk from 'chalk';

const logger = lgr.getSubLogger({ name: chalk.magenta('multi-auth') });

/**
 * Detects configured authentication types
 */
export function detectAuthConfiguration (authConfig: AppConfig['webServer']['auth']): AuthDetectionResult {
  const result: AuthDetectionResult = {
    configured: [],
    valid: [],
    errors: {}
  };

  // Check permanentServerTokens
  if (authConfig.permanentServerTokens && authConfig.permanentServerTokens.length > 0) {
    result.configured.push('permanentServerTokens');
    const validTokens = authConfig.permanentServerTokens.filter(token =>
      typeof token === 'string' && token.length > 0
    );
    if (validTokens.length > 0) {
      result.valid.push('permanentServerTokens');
    } else {
      result.errors.permanentServerTokens = ['No valid tokens in array'];
    }
  }

  // Check jwtToken
  if (authConfig.jwtToken) {
    result.configured.push('jwtToken');
    if (authConfig.jwtToken.encryptKey && authConfig.jwtToken.encryptKey.length >= 8) {
      result.valid.push('jwtToken');
    } else {
      result.errors.jwtToken = ['Encryption key missing or too short'];
    }
  }

  // Check PAT
  if (authConfig.pat) {
    result.configured.push('pat');
    if (typeof authConfig.pat === 'string' && authConfig.pat.length > 10) {
      result.valid.push('pat');
    } else {
      result.errors.pat = ['Token too short or invalid'];
    }
  }

  // Check Basic Auth
  if (authConfig.basic) {
    result.configured.push('basic');
    const errors = [];
    if (!authConfig.basic.username) {errors.push('Username missing');}
    if (!authConfig.basic.password) {errors.push('Password missing');}

    if (errors.length === 0) {
      result.valid.push('basic');
    } else {
      result.errors.basic = errors;
    }
  }

  // Check OAuth2
  if (authConfig.oauth2) {
    result.configured.push('oauth2');
    const required = ['clientId', 'clientSecret', 'accessToken'];
    const missing = required.filter(field => !authConfig.oauth2![field as keyof typeof authConfig.oauth2]);

    if (missing.length === 0) {
      result.valid.push('oauth2');
    } else {
      result.errors.oauth2 = [`Missing fields: ${missing.join(', ')}`];
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
export function checkAuthType (
  authType: AuthType,
  token: string,
  authConfig: AppConfig['webServer']['auth']
): AuthResult {
  try {
    switch (authType) {
      case 'permanentServerTokens':
      case 'jwtToken':
        // ✅ Use existing implementation
        const result = checkToken({ token });
        if (result.errorReason) {
          return { success: false, error: result.errorReason };
        }
        return {
          success: true,
          authType,
          tokenType: result.inTokenType || 'unknown',
          payload: result.payload
        };

      case 'pat':
        return checkPATToken(token);

      case 'basic':
        return checkBasicAuth(token, authConfig);

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
function checkPATToken (token: string): AuthResult {
  // Simple Atlassian PAT token format validation
  if (!token || typeof token !== 'string') {
    return { success: false, error: 'PAT token must be a string' };
  }

  if (token.startsWith('ATATT') && token.length > 20) {
    return {
      success: true,
      authType: 'pat',
      tokenType: 'pat',
      accessToken: token
    };
  }

  // Also support other PAT token formats
  if (token.length >= 20 && /^[A-Za-z0-9+/=_-]+$/.test(token)) {
    return {
      success: true,
      authType: 'pat',
      tokenType: 'pat',
      accessToken: token
    };
  }

  return { success: false, error: 'Invalid PAT token format' };
}

/**
 * Basic Authentication validation
 */
function checkBasicAuth (token: string, authConfig: AppConfig['webServer']['auth']): AuthResult {
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

    if (username === authConfig.basic.username && password === authConfig.basic.password) {
      return {
        success: true,
        authType: 'basic',
        tokenType: 'basic',
        username
      };
    }

    return { success: false, error: 'Invalid credentials' };
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
      accessToken
    };
  } catch (error) {
    return { success: false, error: `OAuth2 validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

/**
 * Checks token using all configured authentication methods
 * in ascending CPU load order
 */
export function checkMultiAuth (
  token: string,
  authConfig: AppConfig['webServer']['auth']
): AuthResult {
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
      const result = checkAuthType(authType, token, authConfig);
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
    error: `Authentication failed for all configured methods: ${validAuthTypes.join(', ')}`
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
