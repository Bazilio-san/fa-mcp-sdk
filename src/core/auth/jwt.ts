// noinspection UnnecessaryLocalVariableJS
import crypto from 'crypto';

import chalk from 'chalk';
import jwt, { JwtPayload, SignOptions, VerifyOptions } from 'jsonwebtoken';

import { appConfig } from '../bootstrap/init-config.js';
import { logger as lgr } from '../logger.js';
import { isObject, trim } from '../utils/utils.js';

import { parseIpList, isIpAllowed } from './ip-check.js';
import { isJtiRevoked, isJwtTokenRevoked, isUserRevoked } from './revocation.js';
import { ICheckTokenResult, ITokenPayload } from './types.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('token-auth') });

const { jwtToken } = appConfig.webServer?.auth || {};
const checkMCPName = jwtToken?.checkMCPName || false;
const isCheckIP = jwtToken?.isCheckIP || false;
const configuredIssuer = trim(jwtToken?.issuer);

export const MIN_ENCRYPT_KEY_LENGTH = 8;

const ENCRYPT_KEY = String(jwtToken?.encryptKey || '11111111-7777-8888-9999-000000000000');

// Legacy AES-256-CTR — used ONLY to read tokens issued before the migration to standard JWT.
const LEGACY_ALGORITHM = 'aes-256-ctr';
const LEGACY_KEY = crypto.createHash('sha256').update(ENCRYPT_KEY).digest('base64').substring(0, 32);

export const legacyJwtRE = /^(\d{13,})\.([\da-fA-F]{32,})$/;
export const standardJwtRE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// "Looks like JWT" helper (either legacy or standard). Not used as the only criterion for auth routing.
export const jwtTokenRE = /^(?:\d{13,}\.[\da-fA-F]{32,}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

const STANDARD_CLAIMS = new Set(['user', 'expire', 'iat', 'service', 'iss', 'sub', 'aud', 'exp', 'jti']);

/**
 * Legacy: encrypts text with the symmetric key from config.
 * Retained ONLY for backward-compatible reading of pre-migration tokens.
 */
export const encrypt = (text: string): string => {
  const buffer = Buffer.from(text);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(LEGACY_ALGORITHM, LEGACY_KEY, iv);
  const encryptedBuf = Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
  return encryptedBuf.toString('hex');
};

/**
 * Legacy: decrypts text with the symmetric key from config.
 * Retained ONLY for backward-compatible reading of pre-migration tokens.
 */
export const decrypt = (encryptedStr: string) => {
  const encryptedByf = Buffer.from(encryptedStr, 'hex');
  const iv2 = encryptedByf.subarray(0, 16);
  const restBuf = encryptedByf.subarray(16);
  const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, LEGACY_KEY, iv2);
  const decryptedBuf = Buffer.concat([decipher.update(restBuf), decipher.final()]);
  return decryptedBuf.toString();
};

/**
 * Generates a standard signed JWT (HS256).
 * - `user` becomes `sub`
 * - `service` becomes `aud`
 * - `expire` becomes `exp`
 * - `jti` is auto-generated via crypto.randomUUID()
 * - other payload keys are written as private claims
 * - `iss` is added only when webServer.auth.jwtToken.issuer is configured
 */
export const generateToken = (user: string, liveTimeSec: number, payload?: any): string => {
  user = trim(user).toLowerCase();
  if (!user) {
    throw new Error('generateToken: Username is empty');
  }
  const inputPayload = isObject(payload) ? { ...payload } : {};

  // Extract reserved fields and drop them from the private claims
  const service = trim(inputPayload.service) || undefined;
  delete inputPayload.user;
  delete inputPayload.expire;
  delete inputPayload.iat;
  delete inputPayload.service;
  delete inputPayload.sub;
  delete inputPayload.aud;
  delete inputPayload.exp;
  delete inputPayload.iss;
  delete inputPayload.jti;

  const signOptions: SignOptions = {
    algorithm: 'HS256',
    subject: user,
    expiresIn: liveTimeSec,
    jwtid: crypto.randomUUID(),
  };
  if (service) {
    signOptions.audience = service;
  }
  if (configuredIssuer) {
    signOptions.issuer = configuredIssuer;
  }
  return jwt.sign(inputPayload, ENCRYPT_KEY, signOptions);
};

/**
 * Verifies a token.
 * Routes by format:
 *   - `header.payload.signature` → standard JWT verification
 *   - `<expire_ms>.<hex>` → legacy AES-256-CTR fallback
 * Returns a normalized `ITokenPayload`.
 */
export const checkJwtToken = (arg: {
  token: string;
  expectedUser?: string;
  expectedService?: string;
  clientIp?: string;
}): ICheckTokenResult => {
  const token = trim(arg.token);
  if (!token) {
    return { errorReason: 'Token not passed' };
  }
  if (standardJwtRE.test(token)) {
    return checkStandardJwt(token, arg);
  }
  if (legacyJwtRE.test(token)) {
    return checkLegacyJwt(token, arg);
  }
  return { errorReason: 'The token is not a JWT' };
};

function checkStandardJwt(
  token: string,
  arg: { expectedUser?: string; expectedService?: string; clientIp?: string },
): ICheckTokenResult {
  // Exact-match revoke against the full token string (works for legacy revoke records too)
  if (isJwtTokenRevoked(token)) {
    return { errorReason: 'JWT Token has been revoked' };
  }

  let decoded: JwtPayload;
  try {
    const verifyOptions: VerifyOptions = { algorithms: ['HS256'] };
    if (configuredIssuer) {
      verifyOptions.issuer = configuredIssuer;
    }
    const result = jwt.verify(token, ENCRYPT_KEY, verifyOptions);
    if (typeof result === 'string') {
      return { errorReason: 'The token is not a JWT' };
    }
    decoded = result;
  } catch (err: Error | any) {
    if (err?.name === 'TokenExpiredError') {
      const expiredAt = err.expiredAt instanceof Date ? err.expiredAt.getTime() : 0;
      const expiredOn = expiredAt ? Date.now() - expiredAt : 0;
      return {
        isTokenDecrypted: true,
        errorReason: expiredOn > 0 ? `JWT Token expired :: on ${expiredOn} mc` : 'JWT Token expired',
      };
    }
    if (err?.name === 'JsonWebTokenError') {
      if (typeof err.message === 'string' && err.message.toLowerCase().includes('signature')) {
        return { errorReason: 'Invalid signature' };
      }
      if (typeof err.message === 'string' && err.message.toLowerCase().includes('issuer')) {
        return { errorReason: `JWT Token: ${err.message}` };
      }
      return { errorReason: 'The token is not a JWT' };
    }
    logger.error(err);
    return { errorReason: `Error verifying JWT token :: ${err?.message ?? 'unknown error'}` };
  }

  // Normalize to ITokenPayload shape
  const sub = typeof decoded.sub === 'string' ? decoded.sub : '';
  if (!sub) {
    return { errorReason: 'JWT Token: missing subject' };
  }
  const expSec = typeof decoded.exp === 'number' ? decoded.exp : 0;
  if (!expSec) {
    return { isTokenDecrypted: true, errorReason: 'JWT Token: missing expiration' };
  }
  const iatSec = typeof decoded.iat === 'number' ? decoded.iat : 0;
  const audValues = Array.isArray(decoded.aud)
    ? decoded.aud.filter((value): value is string => typeof value === 'string' && !!trim(value))
    : typeof decoded.aud === 'string' && trim(decoded.aud)
      ? [decoded.aud]
      : [];
  const expectedService = arg.expectedService ?? appConfig.name;
  const normalizedService = expectedService && audValues.includes(expectedService) ? expectedService : audValues[0];

  const payload: ITokenPayload = { user: sub, expire: expSec * 1000 };
  if (iatSec) {
    payload.iat = new Date(iatSec * 1000).toISOString();
  }
  if (normalizedService) {
    payload.service = normalizedService;
  }
  if (typeof decoded.iss === 'string') {
    payload.iss = decoded.iss;
  }
  if (typeof decoded.jti === 'string') {
    payload.jti = decoded.jti;
  }
  // copy private claims (everything not in STANDARD_CLAIMS)
  for (const [k, v] of Object.entries(decoded)) {
    if (!STANDARD_CLAIMS.has(k)) {
      payload[k] = v;
    }
  }

  // Revoke by jti
  if (payload.jti && isJtiRevoked(payload.jti)) {
    return { isTokenDecrypted: true, errorReason: 'JWT Token has been revoked' };
  }

  if (isUserRevoked(payload.user)) {
    return { isTokenDecrypted: true, errorReason: `JWT Token: user '${payload.user}' has been revoked` };
  }

  const expectedUser = trim(arg.expectedUser).toLowerCase();
  if (expectedUser && payload.user !== expectedUser) {
    return {
      isTokenDecrypted: true,
      errorReason: `JWT Token: user not match :: Expected  '${expectedUser}' / obtained from the token: '${payload.user}'`,
    };
  }

  if (checkMCPName) {
    const obtainedService = audValues.length > 1 ? audValues.join(', ') : payload.service;
    if (expectedService && !audValues.includes(expectedService)) {
      return {
        isTokenDecrypted: true,
        errorReason: `JWT Token: service not match :: Expected  '${expectedService}' / obtained from the token: '${obtainedService}'`,
      };
    }
  }

  if (isCheckIP && payload.ip && arg.clientIp) {
    const allowedIps = parseIpList(payload.ip);
    if (allowedIps.length > 0 && !isIpAllowed(arg.clientIp, allowedIps)) {
      return {
        isTokenDecrypted: true,
        errorReason: `JWT Token: client IP ${arg.clientIp} is not in the allowed list`,
      };
    }
  }

  return { payload };
}

function checkLegacyJwt(
  token: string,
  arg: { expectedUser?: string; expectedService?: string; clientIp?: string },
): ICheckTokenResult {
  const [, expirePartStr, encryptedPayload] = legacyJwtRE.exec(token) || [];
  if (!expirePartStr || !encryptedPayload) {
    return { errorReason: 'The token is not a JWT' };
  }

  if (isJwtTokenRevoked(token)) {
    return { errorReason: 'JWT Token has been revoked' };
  }

  let payloadStr: string = '';
  try {
    payloadStr = decrypt(encryptedPayload);
    if (!payloadStr.startsWith('{')) {
      return { errorReason: 'Error decrypting JWT token :: the transcribed text is not JSON' };
    }
  } catch (err: Error | any) {
    logger.error(err);
    return { errorReason: `Error decrypting JWT token :: ${err.message}` };
  }
  let payload: ITokenPayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch (err: Error | any) {
    logger.error(err);
    return { errorReason: `Error deserializing payload of JWT token :: ${err.message}` };
  }

  if (isUserRevoked(payload.user)) {
    return {
      isTokenDecrypted: true,
      errorReason: `JWT Token: user '${payload.user}' has been revoked`,
    };
  }

  const expectedUser = trim(arg.expectedUser).toLowerCase();
  if (expectedUser && payload.user !== expectedUser) {
    return {
      isTokenDecrypted: true,
      errorReason: `JWT Token: user not match :: Expected  '${expectedUser}' / obtained from the token: '${payload.user}'`,
    };
  }

  if (checkMCPName) {
    const expectedService = arg.expectedService ?? appConfig.name;
    if (expectedService && payload.service !== expectedService) {
      return {
        isTokenDecrypted: true,
        errorReason: `JWT Token: service not match :: Expected  '${expectedService}' / obtained from the token: '${payload.service}'`,
      };
    }
  }

  const expire = Number(expirePartStr) || 0;
  const expiredOn = Date.now() - expire;
  if (expiredOn > 0) {
    return {
      isTokenDecrypted: true,
      errorReason: `JWT Token expired :: on ${expiredOn} mc`,
    };
  }

  if (isCheckIP && payload.ip && arg.clientIp) {
    const allowedIps = parseIpList(payload.ip);
    if (allowedIps.length > 0 && !isIpAllowed(arg.clientIp, allowedIps)) {
      return {
        isTokenDecrypted: true,
        errorReason: `JWT Token: client IP ${arg.clientIp} is not in the allowed list`,
      };
    }
  }

  return { payload };
}
