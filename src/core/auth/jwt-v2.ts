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
import { logInternalError } from '../errors/errors.js';
import { logger as lgr } from '../logger.js';
import { isObject, trim } from '../utils/utils.js';

import { parseIpList, isIpAllowed } from './ip-check.js';
import { RESERVED_USER_CLAIMS } from './jwt-claims.js';
import { getJwtRuntimeConfig, getKeyResolver } from './key-resolver.js';
import { isUsableAuthIdentity } from './principal.js';
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
  if (!isUsableAuthIdentity(normalizedUser)) {
    throw new Error('generateTokenV2: Username is empty or invalid');
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
  const { expectedIssuer, expectedAudience, userClaim } = getJwtRuntimeConfig();
  for (const reserved of ['user', 'expire', 'iat', 'service', 'sub', 'aud', 'exp', 'iss', 'jti', 'nbf', userClaim]) {
    if (!reserved) {
      continue;
    }
    delete inputPayload[reserved];
  }
  if (userClaim) {
    if (RESERVED_USER_CLAIMS.has(userClaim)) {
      throw new Error(`generateTokenV2: configured userClaim "${userClaim}" is reserved`);
    }
    inputPayload[userClaim] = normalizedUser;
  }

  const { algorithm, privateKey, kid } = resolver.getSignContext();

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

  const { expectedIssuer, expectedAudience, clockSkew, algorithm, userClaim } = getJwtRuntimeConfig();
  const isCheckIP = appConfig.webServer?.auth?.jwtToken?.isCheckIP || false;
  const wantService = arg.expectedService || expectedAudience || appConfig.name;

  let payloadDecoded: Record<string, any>;
  try {
    const { payload } = await jwtVerify(token, (header) => resolver.getVerifyKey(header) as any, {
      ...(expectedIssuer ? { issuer: expectedIssuer } : {}),
      audience: wantService,
      algorithms: [algorithm],
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
      return { errorReason: `JWT claim validation failed (${err.code})` };
    }
    if (err instanceof joseErrors.JOSEError) {
      logger.debug(`JWT verification rejected: ${err.code}`);
      return { errorReason: 'The token is not a JWT' };
    }
    logInternalError(err, 'jwt_v2_verification');
    return { errorReason: 'Error verifying JWT token' };
  }

  const sub = typeof payloadDecoded.sub === 'string' ? payloadDecoded.sub : '';
  if (!isUsableAuthIdentity(sub)) {
    return {
      isTokenDecrypted: true,
      errorReason: sub ? 'JWT Token: subject is invalid' : 'JWT Token: missing subject',
    };
  }
  if (userClaim && RESERVED_USER_CLAIMS.has(userClaim)) {
    return { errorReason: 'JWT verifier has an invalid user-claim configuration' };
  }
  const identityValue = userClaim ? payloadDecoded[userClaim] : sub;
  if (!isUsableAuthIdentity(identityValue)) {
    return { isTokenDecrypted: true, errorReason: 'JWT Token: configured user claim is missing or invalid' };
  }
  const employeeUser = trim(identityValue).toLowerCase();
  const expSec = typeof payloadDecoded.exp === 'number' ? payloadDecoded.exp : 0;
  if (!expSec) {
    return { isTokenDecrypted: true, errorReason: 'JWT Token: missing expiration' };
  }
  const iatSec = typeof payloadDecoded.iat === 'number' ? payloadDecoded.iat : 0;
  if (!iatSec) {
    return { isTokenDecrypted: true, errorReason: 'JWT Token: missing issued-at time' };
  }
  if (iatSec > Math.floor(Date.now() / 1000) + clockSkew) {
    return { isTokenDecrypted: true, errorReason: 'JWT Token: issued-at time is in the future' };
  }
  if (typeof payloadDecoded.iss !== 'string' || !payloadDecoded.iss) {
    return { isTokenDecrypted: true, errorReason: 'JWT Token: missing issuer' };
  }
  const audValues = Array.isArray(payloadDecoded.aud)
    ? (payloadDecoded.aud as unknown[]).filter((v): v is string => typeof v === 'string' && !!trim(v))
    : typeof payloadDecoded.aud === 'string' && trim(payloadDecoded.aud)
      ? [payloadDecoded.aud]
      : [];
  const normalizedService = wantService && audValues.includes(wantService) ? wantService : audValues[0];

  const normalized: ITokenPayload = { sub, user: employeeUser, expire: expSec * 1000 };
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
    if (!STANDARD_CLAIMS.has(k) && k !== userClaim) {
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

  // jwtVerify already enforces audience. Keep this explicit guard for a stable error if a future
  // jose version changes the decoded payload shape.
  if (!audValues.includes(wantService)) {
    return { isTokenDecrypted: true, errorReason: 'JWT Token: audience does not match this MCP server' };
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
