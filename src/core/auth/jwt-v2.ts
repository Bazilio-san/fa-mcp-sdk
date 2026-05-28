/**
 * jwt-v2 — sign + verify standard JWT using asymmetric keys (ES256/RS256) via jose.
 *
 * This module is only active when webServer.auth.jwtToken.mode is one of:
 *   - embedded   (built-in IdP, autogen keys, local issuance)
 *   - localKey   (PEM-based public/private keys on disk)
 *   - remoteJwks (verify only — tokens issued by external IdP)
 *
 * The legacy AES-CTR + HS256 path stays in jwt.ts.
 */

import crypto from 'crypto';

import chalk from 'chalk';
import { jwtVerify, SignJWT, errors as joseErrors } from 'jose';

import { appConfig } from '../bootstrap/init-config.js';
import { logger as lgr } from '../logger.js';
import { isObject, trim } from '../utils/utils.js';

import { parseIpList, isIpAllowed } from './ip-check.js';
import { getJwtRuntimeConfig, getKeyResolver } from './key-resolver.js';
import { isJtiRevoked, isJwtTokenRevoked, isUserRevoked } from './revocation.js';
import { ICheckTokenResult, ITokenPayload } from './types.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('token-auth-v2') });

const STANDARD_CLAIMS = new Set(['user', 'expire', 'iat', 'service', 'iss', 'sub', 'aud', 'exp', 'jti', 'nbf']);

/**
 * Issue a standard JWT signed with the asymmetric key from the current KeyResolver.
 * Mirrors generateToken() signature in jwt.ts so callsites stay compatible.
 */
export async function generateTokenV2(user: string, liveTimeSec: number, payload?: any): Promise<string> {
  const normalizedUser = trim(user).toLowerCase();
  if (!normalizedUser) {
    throw new Error('generateTokenV2: Username is empty');
  }

  const resolver = await getKeyResolver();
  if (!resolver) {
    throw new Error('generateTokenV2: KeyResolver is not available in legacy mode');
  }
  if (!resolver.canSign()) {
    const { mode, jwksUri } = getJwtRuntimeConfig();
    throw new Error(
      `Token issuance is not available in mode=${mode}.${jwksUri ? ` Obtain tokens from the IdP at ${jwksUri}.` : ''}`,
    );
  }

  const inputPayload = isObject(payload) ? { ...payload } : {};
  const service = trim(inputPayload.service) || undefined;
  for (const reserved of ['user', 'expire', 'iat', 'service', 'sub', 'aud', 'exp', 'iss', 'jti', 'nbf']) {
    delete inputPayload[reserved];
  }

  const { algorithm, privateKey, kid } = resolver.getSignContext();
  const { expectedIssuer, expectedAudience } = getJwtRuntimeConfig();

  const issuer = expectedIssuer || `urn:fa-mcp:${appConfig.shortName || appConfig.name}`;
  const audience = service || expectedAudience || appConfig.name;

  const builder = new SignJWT(inputPayload)
    .setProtectedHeader({ alg: algorithm, kid, typ: 'JWT' })
    .setSubject(normalizedUser)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + liveTimeSec)
    .setJti(crypto.randomUUID());
  if (issuer) {
    builder.setIssuer(issuer);
  }
  if (audience) {
    builder.setAudience(audience);
  }
  return builder.sign(privateKey);
}

/**
 * Verify a standard JWT issued under embedded/localKey/remoteJwks modes.
 * Returns the same ICheckTokenResult shape as checkJwtToken() so multi-auth.ts stays unchanged.
 */
export async function verifyJwtV2(arg: {
  token: string;
  expectedUser?: string;
  expectedService?: string;
  clientIp?: string;
}): Promise<ICheckTokenResult> {
  const token = trim(arg.token);
  if (!token) {
    return { errorReason: 'Token not passed' };
  }

  if (isJwtTokenRevoked(token)) {
    return { errorReason: 'JWT Token has been revoked' };
  }

  const resolver = await getKeyResolver();
  if (!resolver) {
    return { errorReason: 'JWT verifier not initialized (legacy mode)' };
  }

  const { expectedIssuer, expectedAudience, clockSkew } = getJwtRuntimeConfig();
  const checkMCPName = appConfig.webServer?.auth?.jwtToken?.checkMCPName || false;
  const isCheckIP = appConfig.webServer?.auth?.jwtToken?.isCheckIP || false;
  const wantService = arg.expectedService ?? expectedAudience ?? appConfig.name;

  let payloadDecoded: Record<string, any>;
  try {
    const { payload } = await jwtVerify(token, (header) => resolver.getVerifyKey(header) as any, {
      ...(expectedIssuer ? { issuer: expectedIssuer } : {}),
      // jose's audience check passes when the token's aud (string or array) intersects ours.
      // We do our own check below to surface the same error wording as legacy code.
      clockTolerance: clockSkew,
    });
    payloadDecoded = payload as Record<string, any>;
  } catch (err: any) {
    if (err instanceof joseErrors.JWTExpired) {
      const expSec = (err.payload as any)?.exp;
      const expiredOn = expSec ? Date.now() - expSec * 1000 : 0;
      return {
        isTokenDecrypted: true,
        errorReason: expiredOn > 0 ? `JWT Token expired :: on ${expiredOn} mc` : 'JWT Token expired',
      };
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      return { errorReason: 'Invalid signature' };
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      return { errorReason: `JWT Token: ${err.message}` };
    }
    if (err instanceof joseErrors.JOSEError) {
      logger.debug(`JOSE error: ${err.message}`);
      return { errorReason: 'The token is not a JWT' };
    }
    logger.error('verifyJwtV2 unexpected error:', err);
    return { errorReason: `Error verifying JWT token :: ${err?.message ?? 'unknown error'}` };
  }

  const sub = typeof payloadDecoded.sub === 'string' ? payloadDecoded.sub : '';
  if (!sub) {
    return { errorReason: 'JWT Token: missing subject' };
  }
  const expSec = typeof payloadDecoded.exp === 'number' ? payloadDecoded.exp : 0;
  if (!expSec) {
    return { isTokenDecrypted: true, errorReason: 'JWT Token: missing expiration' };
  }
  const iatSec = typeof payloadDecoded.iat === 'number' ? payloadDecoded.iat : 0;
  const audValues = Array.isArray(payloadDecoded.aud)
    ? (payloadDecoded.aud as unknown[]).filter((v): v is string => typeof v === 'string' && !!trim(v))
    : typeof payloadDecoded.aud === 'string' && trim(payloadDecoded.aud)
      ? [payloadDecoded.aud]
      : [];
  const normalizedService = wantService && audValues.includes(wantService) ? wantService : audValues[0];

  const normalized: ITokenPayload = { user: sub, expire: expSec * 1000 };
  if (iatSec) {
    normalized.iat = new Date(iatSec * 1000).toISOString();
  }
  if (normalizedService) {
    normalized.service = normalizedService;
  }
  if (typeof payloadDecoded.iss === 'string') {
    normalized.iss = payloadDecoded.iss;
  }
  if (typeof payloadDecoded.jti === 'string') {
    normalized.jti = payloadDecoded.jti;
  }
  for (const [k, v] of Object.entries(payloadDecoded)) {
    if (!STANDARD_CLAIMS.has(k)) {
      normalized[k] = v;
    }
  }

  if (normalized.jti && isJtiRevoked(normalized.jti)) {
    return { isTokenDecrypted: true, errorReason: 'JWT Token has been revoked' };
  }

  if (isUserRevoked(normalized.user)) {
    return { isTokenDecrypted: true, errorReason: `JWT Token: user '${normalized.user}' has been revoked` };
  }

  const expectedUser = trim(arg.expectedUser).toLowerCase();
  if (expectedUser && normalized.user !== expectedUser) {
    return {
      isTokenDecrypted: true,
      errorReason: `JWT Token: user not match :: Expected  '${expectedUser}' / obtained from the token: '${normalized.user}'`,
    };
  }

  if (checkMCPName) {
    const obtainedService = audValues.length > 1 ? audValues.join(', ') : normalized.service;
    if (wantService && !audValues.includes(wantService)) {
      return {
        isTokenDecrypted: true,
        errorReason: `JWT Token: service not match :: Expected  '${wantService}' / obtained from the token: '${obtainedService}'`,
      };
    }
  }

  if (isCheckIP && normalized.ip && arg.clientIp) {
    const allowedIps = parseIpList(normalized.ip);
    if (allowedIps.length > 0 && !isIpAllowed(arg.clientIp, allowedIps)) {
      return {
        isTokenDecrypted: true,
        errorReason: `JWT Token: client IP ${arg.clientIp} is not in the allowed list`,
      };
    }
  }

  return { payload: normalized };
}
