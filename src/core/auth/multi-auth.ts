// noinspection UnnecessaryLocalVariableJS

/**
 * Multi-authentication system core
 */

import { Request } from 'express';
import { checkJwtToken, generateToken, jwtTokenRE, MIN_ENCRYPT_KEY_LENGTH } from './jwt.js';
import { logger as lgr } from '../logger.js';
import { AuthDetectionResult, AuthResult, AuthType } from './types.js';
import { CustomAuthValidator } from '../_types_/types.js';
import { normalizeHeaders, trim } from '../utils/utils.js';
import chalk from 'chalk';
import { appConfig } from '../bootstrap/init-config.js';
import { checkPermanentToken } from './permanent.js';
import { checkBasicAuth } from './basic.js';

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
  'custom': 4,
};

const schemaRe = /^([^ ]+) +(.+)$/;
export const getTokenFromHttpHeader = (req: Request): { scheme?: AuthType, credentials?: string } => {
  const a = trim(req.headers.authorization);
  if (!a) {
    return {};
  }
  let scheme: string = '';
  let credentials: string = a;
  if (schemaRe.test(a)) {
    ([scheme = '', credentials = ''] = a.split(/ +/));
  }
  if (scheme.toLowerCase() === 'basic') {
    return { scheme: 'basic', credentials };
  }
  if (jwtTokenRE.test(credentials)) {
    return { scheme: 'jwtToken', credentials };
  }
  return { scheme: 'permanentServerTokens', credentials };
};

/**
 * Gets custom auth validator from global context
 */
function getCustomAuthValidator (): CustomAuthValidator | undefined {
  const projectData = (global as any).__MCP_PROJECT_DATA__;
  const fn = projectData?.customAuthValidator;
  return typeof fn === 'function' ? fn : undefined;
}

const CUSTOM_AUTH_VALIDATOR = getCustomAuthValidator();


/**
 * Detects configured authentication types in priority order (ascending CPU load)
 */
export function detectAuthConfiguration (): AuthDetectionResult {
  const configured: AuthType[] = [];
  const errors: Record<string, string[]> = {};
  const result: AuthDetectionResult = { configured, errors, configuredSet: new Set(), configuredTypes: '' };

  if (authEnabled) {
    // Check permanentServerTokens
    if (Array.isArray(pt) && pt.filter(Boolean)) {
      configured.push('permanentServerTokens');
    }

    // Check JWT Token
    if (encryptKey?.length) {
      if (encryptKey.length < MIN_ENCRYPT_KEY_LENGTH) {
        errors.jwtToken = [`JWT encryption key is too short (${encryptKey.length} chars) Must be at least ${MIN_ENCRYPT_KEY_LENGTH} chars long`];
      } else {
        configured.push('jwtToken');
      }
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
  }

  if (CUSTOM_AUTH_VALIDATOR) {
    configured.push('custom');
  }

  result.configured = configured.sort((a, b) => authOrder[a] - authOrder[b]);
  result.configuredSet = new Set(result.configured);
  result.configuredTypes = result.configured.join(', ');
  return result;
}

const AUTH_CONFIGURATION = detectAuthConfiguration();

/**
 * Checks auth using all configured authentication methods in ascending CPU load order
 */
export async function checkMultiAuth (req: Request): Promise<AuthResult> {
  const { configured, configuredSet, configuredTypes } = AUTH_CONFIGURATION;
  if (!configured.length) {
    return { success: false, error: 'No authentication methods configured' };
  }
  const { scheme: authType, credentials } = getTokenFromHttpHeader(req);
  if (!credentials) {
    return { success: false, error: 'Auth credentials not provided' };
  }
  if (!authType) {
    return { success: false, error: 'Cannot detect auth type from Authorization header' };
  }
  logger.debug(`Checking auth types: ${configuredTypes}`);

  if (!configuredSet.has(authType)) {
    return { success: false, error: `Detected in Authorisation header auth type ${authType} not configured` };
  }

  let errorResult: AuthResult | undefined = undefined;
  try {
    switch (authType) {
      case 'permanentServerTokens': {
        const error = checkPermanentToken(credentials).errorReason;
        if (!error) {
          return { success: true, authType };
        }
        errorResult = { success: false, authType, error };
        break;
      }

      case 'basic': {
        const result = checkBasicAuth(credentials);
        if (result.success) {
          return { ...result, authType };
        }
        errorResult = { ...result, authType };
        break;
      }

      case 'jwtToken': {
        const { errorReason: error, payload, isTokenDecrypted } = checkJwtToken({ token: credentials });
        if (!error) {
          return { success: true, authType, payload };
        }
        errorResult = { success: false, error, authType, isTokenDecrypted };
        break;
      }

      case 'custom':
        break;

      default:
        errorResult = { success: false, error: `Unknown auth type: ${authType}` };
    }
  } catch (error) {
    logger.warn(`Auth type ${authType} failed with exception:`, error instanceof Error ? error.message : 'Unknown error');
  }
  if (CUSTOM_AUTH_VALIDATOR) {
    const requestWithNormalizedHeaders = { ...req, headers: normalizeHeaders(req.headers || {}) };
    try {
      const customResult = await CUSTOM_AUTH_VALIDATOR(requestWithNormalizedHeaders);
      return customResult;
    } catch (error) {
      logger.error('Custom auth validator failed:', error);
      return { success: false, error: 'Custom authentication validation failed' };
    }
  }

  return errorResult || { success: false, error: `Authentication failed for all configured methods: ${configuredTypes}` };
}

/**
 * Logs authentication configuration (for debugging)
 */
export function logAuthConfiguration (): void {
  const { configured, errors } = AUTH_CONFIGURATION;

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

/**
 * Determines authentication headers based on appConfig.webServer.auth configuration.
 * Priority order:
 * 1. permanentServerTokens - if at least one token is defined
 * 2. basic auth - if username AND password are both set
 * 3. JWT token - if jwtToken.encryptKey is set, generate token on the fly
 * @returns {Object} Headers object with Authorization header if auth is enabled
 */
export function getAuthHeadersForTests (): object {
  const auth = appConfig.webServer?.auth;

  // If auth is not enabled, no headers needed
  if (!auth?.enabled) {
    return {};
  }

  // 1. Check permanentServerTokens first (fastest CPU cost)
  const tokens = auth.permanentServerTokens;
  if (Array.isArray(tokens) && tokens.length > 0) {
    // Find first non-empty token
    const validToken = tokens.find(trim);
    if (validToken) {
      console.log('  Using permanentServerToken for authentication');
      return { Authorization: `Bearer ${validToken}` };
    }
  }

  // 2. Check basic auth (username AND password must both be set)
  const basic = auth.basic;
  if (basic?.username && basic?.password) {
    const credentials = Buffer.from(`${basic.username}:${basic.password}`).toString('base64');
    console.log('  Using Basic authentication');
    return { Authorization: `Basic ${credentials}` };
  }

  // 3. Check JWT token - generate on the fly if encryptKey is set
  const jwtConfig = auth.jwtToken;
  if (jwtConfig?.encryptKey && jwtConfig.encryptKey.trim().length > 0) {
    const token = generateToken('vpupkin', 100, { service: appConfig.name });
    console.log('  Using generated JWT token for authentication');
    return { Authorization: `Bearer ${token}` };
  }

  // No valid auth method configured but auth is enabled
  console.warn('⚠️  Auth is enabled but no valid authentication method is configured!');
  console.warn('   Configure one of: permanentServerTokens, basic auth, or jwtToken.encryptKey');
  return {};
}
