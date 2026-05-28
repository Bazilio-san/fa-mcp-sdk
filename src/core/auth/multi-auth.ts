// noinspection UnnecessaryLocalVariableJS

/**
 * Multi-authentication system core
 */

import chalk from 'chalk';
import { Request } from 'express';

import { CustomAuthValidator } from '../_types_/types.js';
import { appConfig } from '../bootstrap/init-config.js';
import { logger as lgr } from '../logger.js';
import { normalizeHeaders, trim } from '../utils/utils.js';

import { checkBasicAuth } from './basic.js';
import { checkJwtToken, generateToken, jwtTokenRE, MIN_ENCRYPT_KEY_LENGTH } from './jwt.js';
import { canLocallyIssueJwt } from './key-resolver.js';
import { checkPermanentToken } from './permanent.js';
import { AuthDetectionResult, AuthResult, AuthType } from './types.js';

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
  permanentServerTokens: 1, // O(1) Set.has()
  basic: 2, // Base64 decoding
  jwtToken: 3, // Symmetric decryption + JSON.parse
  custom: 4,
};

export type AuthScheme = 'basic' | 'bearer';

const schemaRe = /^([^ ]+) +(.+)$/;
export const getTokenFromHttpHeader = (
  req: Request,
): { scheme?: AuthScheme; credentials?: string; looksLikeJwt?: boolean } => {
  const a = trim(req.headers.authorization);
  if (!a) {
    return {};
  }
  let scheme: string = '';
  let credentials: string = a;
  if (schemaRe.test(a)) {
    [scheme = '', credentials = ''] = a.split(/ +/);
  }
  if (scheme.toLowerCase() === 'basic') {
    return { scheme: 'basic', credentials };
  }
  return { scheme: 'bearer', credentials, looksLikeJwt: jwtTokenRE.test(credentials) };
};

/**
 * Gets custom auth validator from global context.
 *
 * Lazy lookup with memoization: `global.__MCP_PROJECT_DATA__` is assigned inside `initMcpServer()`,
 * which runs AFTER this module is imported — so a module-level capture would always read undefined.
 * We therefore resolve it on first call and only cache the result once project data is installed.
 */
let _cachedValidator: CustomAuthValidator | null | undefined;

function getCustomAuthValidator(): CustomAuthValidator | undefined {
  if (_cachedValidator !== undefined) {
    return _cachedValidator ?? undefined;
  }
  const projectData = global.__MCP_PROJECT_DATA__;
  if (!projectData) {
    // Not yet installed — don't cache, allow retry on next call
    return undefined;
  }
  const fn = projectData.customAuthValidator;
  _cachedValidator = typeof fn === 'function' ? fn : null;
  return _cachedValidator ?? undefined;
}

/**
 * Detects configured authentication types in priority order (ascending CPU load)
 */
export function detectAuthConfiguration(): AuthDetectionResult {
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
        errors.jwtToken = [
          `JWT encryption key is too short (${encryptKey.length} chars) Must be at least ${MIN_ENCRYPT_KEY_LENGTH} chars long`,
        ];
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

  if (getCustomAuthValidator()) {
    configured.push('custom');
  }

  result.configured = configured.sort((a, b) => authOrder[a] - authOrder[b]);
  result.configuredSet = new Set(result.configured);
  result.configuredTypes = result.configured.join(', ');
  return result;
}

/**
 * Lazy, memoized wrapper around {@link detectAuthConfiguration}.
 * The result is only cached after `global.__MCP_PROJECT_DATA__` is installed
 * (so `'custom'` detection reflects the validator registered via `initMcpServer`).
 */
let _cachedAuthConfig: AuthDetectionResult | undefined;

function getAuthConfiguration(): AuthDetectionResult {
  if (_cachedAuthConfig) {
    return _cachedAuthConfig;
  }
  const result = detectAuthConfiguration();
  if (global.__MCP_PROJECT_DATA__) {
    _cachedAuthConfig = result;
  }
  return result;
}

const E_PFX = 'MCP Auth: ';

/**
 * Checks auth using all configured authentication methods in ascending CPU load order
 */
export async function checkMultiAuth(req: Request): Promise<AuthResult> {
  const { configured, configuredSet, configuredTypes } = getAuthConfiguration();
  if (!configured.length) {
    return { success: false, error: `${E_PFX}No authentication methods configured` };
  }

  // Custom validator runs FIRST — can bypass standard auth (e.g. via x-jira-token headers)
  const customValidator = getCustomAuthValidator();
  if (customValidator) {
    const requestWithNormalizedHeaders = { ...req, headers: normalizeHeaders(req.headers || {}) };
    try {
      const customResult = await customValidator(requestWithNormalizedHeaders);
      if (customResult.success) {
        return customResult;
      }
      // success: false → fall through to standard auth
    } catch (error: Error | any) {
      logger.error('Custom auth validator failed:', error);
      // fall through to standard auth
    }
  }

  const { scheme, credentials } = getTokenFromHttpHeader(req);
  if (!credentials) {
    return { success: false, error: `${E_PFX}credentials not provided` };
  }
  if (!scheme) {
    return { success: false, error: `${E_PFX}Cannot detect auth scheme from Authorization header` };
  }
  logger.debug(`Checking auth types: ${configuredTypes}`);

  let errorResult: AuthResult | undefined = undefined;
  try {
    if (scheme === 'basic') {
      if (!configuredSet.has('basic')) {
        return {
          success: false,
          error: `${E_PFX}Detected Basic auth in Authorization header, but 'basic' is not configured`,
        };
      }
      const result = checkBasicAuth(credentials);
      if (result.success) {
        return { ...result, authType: 'basic', payload: { user: result.username! } };
      }
      errorResult = { ...result, authType: 'basic' };
    } else {
      // Bearer / non-Basic: try permanent tokens first (O(1)), then JWT.
      // Permanent tokens can contain dots, so we never classify purely by shape.
      let permError: string | undefined;
      let jwtErrorResult: AuthResult | undefined;

      if (configuredSet.has('permanentServerTokens')) {
        const { errorReason } = checkPermanentToken(credentials);
        if (!errorReason) {
          return { success: true, authType: 'permanentServerTokens' };
        }
        permError = errorReason;
      }

      if (configuredSet.has('jwtToken')) {
        const xff = req.headers['x-forwarded-for'];
        const xffStr = (Array.isArray(xff) ? (xff[0] ?? '') : (xff ?? '')).split(',').shift() ?? '';
        const clientIp = req.ip ?? (xffStr.trim() || (req.socket?.remoteAddress ?? ''));
        const { errorReason, payload, isTokenDecrypted } = await checkJwtToken({ token: credentials, clientIp });
        if (!errorReason) {
          return { success: true, authType: 'jwtToken', payload };
        }
        jwtErrorResult = { success: false, error: `${E_PFX}${errorReason}`, authType: 'jwtToken', isTokenDecrypted };
      }

      // Prefer the JWT-specific error (it's more informative for malformed/expired JWTs).
      // Fall back to the permanent token error if JWT wasn't configured/attempted.
      if (jwtErrorResult) {
        errorResult = jwtErrorResult;
      } else if (permError) {
        errorResult = { success: false, authType: 'permanentServerTokens', error: `${E_PFX}${permError}` };
      } else {
        errorResult = {
          success: false,
          error: `${E_PFX}No bearer auth method is configured (need permanentServerTokens or jwtToken)`,
        };
      }
    }
  } catch (error: Error | any) {
    logger.warn(
      `Auth scheme ${scheme} failed with exception:`,
      error instanceof Error ? E_PFX + error.message : 'Unknown error',
    );
  }

  return (
    errorResult || {
      success: false,
      error: `${E_PFX}Authentication failed for all configured methods: ${configuredTypes}`,
    }
  );
}

/**
 * Logs authentication configuration (for debugging)
 */
export function logAuthConfiguration(): void {
  const { configured, errors } = getAuthConfiguration();

  logger.info('Auth system configuration:');
  logger.info(`- enabled: ${!!appConfig.webServer?.auth?.enabled}`);
  logger.info(`- configured types: ${configured.join(', ')}`);

  if (Object.keys(errors).length) {
    logger.warn('Auth configuration errors:');
    Object.entries(errors).forEach(([type, errors_]) => {
      logger.warn(`- ${type}: ${errors_.join(', ')}`);
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
export async function getAuthHeadersForTests(): Promise<object> {
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
  const { basic } = auth;
  if (basic?.username && basic?.password) {
    const credentials = Buffer.from(`${basic.username}:${basic.password}`).toString('base64');
    console.log('  Using Basic authentication');
    return { Authorization: `Basic ${credentials}` };
  }

  // 3. JWT token — generate on the fly if we can actually sign one (any non-remoteJwks mode)
  if (canLocallyIssueJwt()) {
    const token = await generateToken('vpupkin', 100, { service: appConfig.name });
    console.log('  Using generated JWT token for authentication');
    return { Authorization: `Bearer ${token}` };
  }

  // No valid auth method configured but auth is enabled
  console.warn('⚠️  Auth is enabled but no valid authentication method is configured!');
  console.warn('   Configure one of: permanentServerTokens, basic auth, or jwtToken (with local signing).');
  return {};
}
