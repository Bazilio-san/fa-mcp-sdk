import { createPublicKey } from 'crypto';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';

import { RESERVED_USER_CLAIMS } from '../auth/jwt-claims.js';
import { isValidPermanentTokenConfig } from '../auth/permanent.js';

interface IProductionSurfaceConfig {
  logger?: { disableMasking?: boolean };
  adminPanel?: { enabled?: boolean; authType?: unknown };
  agentTester?: { enabled?: boolean; useAuth?: boolean };
  webServer?: { metrics?: { enabled?: boolean; requireAuth?: boolean } };
}

interface IHttpAuthPreflightConfig {
  enabled?: boolean;
  permanentServerTokens?: unknown;
  jwtToken?: {
    mode?: string;
    encryptKey?: string;
    algorithm?: string;
    publicKeyPath?: string;
    jwksUri?: string;
    expectedIssuer?: string;
    userClaim?: string;
    jwksCacheTtl?: number;
    jwksCooldown?: number;
    clockSkew?: number;
  };
  oauth?: {
    resourceUrl?: string;
    resourceDocumentationUrl?: string;
    authorizationServers?: string[];
    advertisedScopes?: string[];
  };
}

function configList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return values.map((entry) => String(entry).trim()).filter(Boolean);
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.host);
  } catch {
    return false;
  }
}

function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.host) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function assertLocalPublicKey(publicKeyPath: string, algorithm: string | undefined): void {
  try {
    const pem = readFileSync(resolvePath(publicKeyPath), 'utf8');
    const key = createPublicKey(pem);
    const keyType = key.asymmetricKeyType;
    if (algorithm === 'RS256' ? keyType !== 'rsa' : keyType !== 'ec') {
      throw new Error('key algorithm mismatch');
    }
    if (algorithm !== 'RS256' && key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('ES256 requires the P-256 curve');
    }
  } catch {
    throw new Error(
      'webServer.auth.jwtToken.publicKeyPath must reference a readable, parseable public key compatible with ' +
        `${algorithm ?? 'ES256'}.`,
    );
  }
}

/**
 * Validate only an active HTTP authentication profile. Disabled auth is intentionally inert in
 * development/test, where projects may inherit placeholder JWT/OAuth values from base config.
 * Production is different: it always requires auth and then applies the complete fail-closed profile.
 */
export function assertHttpAuthPreflight(auth: IHttpAuthPreflightConfig | undefined, isProduction: boolean): void {
  const authEnabled = auth?.enabled === true;
  if (!authEnabled) {
    if (isProduction) {
      throw new Error('webServer.auth.enabled must be true for production HTTP MCP servers.');
    }
    return;
  }

  const jwt = auth.jwtToken;
  const jwtMode = jwt?.mode ?? 'legacyAesCtr';
  const supportedJwtModes = new Set(['legacyAesCtr', 'embedded', 'localKey', 'remoteJwks']);
  if (!supportedJwtModes.has(jwtMode)) {
    throw new Error('webServer.auth.jwtToken.mode must be legacyAesCtr, embedded, localKey, or remoteJwks.');
  }
  const skewLimit = 60;
  const userClaim = String(jwt?.userClaim ?? '').trim();
  if (
    userClaim &&
    (userClaim.length > 128 || /[\s\u0000-\u001f\u007f]/.test(userClaim) || RESERVED_USER_CLAIMS.has(userClaim))
  ) {
    throw new Error(
      'webServer.auth.jwtToken.userClaim must be a non-reserved top-level JWT claim name of at most 128 characters.',
    );
  }

  const { oauth } = auth;
  for (const [field, value] of [
    ['resourceUrl', oauth?.resourceUrl],
    ['resourceDocumentationUrl', oauth?.resourceDocumentationUrl],
  ] as const) {
    if (String(value ?? '').trim() && !isAbsoluteHttpUrl(String(value).trim())) {
      throw new Error(`webServer.auth.oauth.${field} must be an absolute HTTP(S) URL.`);
    }
  }
  for (const url of configList(oauth?.authorizationServers)) {
    if (!isAbsoluteHttpUrl(url)) {
      throw new Error('webServer.auth.oauth.authorizationServers must contain only absolute HTTP(S) URLs.');
    }
  }
  if (isProduction && jwtMode !== 'legacyAesCtr') {
    const resourceUrl = String(oauth?.resourceUrl ?? '').trim();
    if (!resourceUrl || !isAbsoluteHttpsUrl(resourceUrl)) {
      throw new Error('webServer.auth.oauth.resourceUrl must be an explicit absolute HTTPS URL in production.');
    }
    const authorizationServers = configList(oauth?.authorizationServers);
    if (authorizationServers.length === 0 || authorizationServers.some((url) => !isAbsoluteHttpsUrl(url))) {
      throw new Error(
        'webServer.auth.oauth.authorizationServers must contain at least one explicit absolute HTTPS URL in production.',
      );
    }
    const documentationUrl = String(oauth?.resourceDocumentationUrl ?? '').trim();
    if (documentationUrl && !isAbsoluteHttpsUrl(documentationUrl)) {
      throw new Error('webServer.auth.oauth.resourceDocumentationUrl must be an absolute HTTPS URL in production.');
    }
  }
  for (const scope of configList(oauth?.advertisedScopes)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(scope)) {
      throw new Error(`Invalid OAuth advertised scope "${scope}".`);
    }
  }
  if (jwt?.algorithm !== undefined && jwt.algorithm !== 'ES256' && jwt.algorithm !== 'RS256') {
    throw new Error('webServer.auth.jwtToken.algorithm must be ES256 or RS256.');
  }
  if (
    jwt?.clockSkew !== undefined &&
    (typeof jwt.clockSkew !== 'number' ||
      !Number.isFinite(jwt.clockSkew) ||
      jwt.clockSkew < 0 ||
      jwt.clockSkew > skewLimit)
  ) {
    throw new Error(`webServer.auth.jwtToken.clockSkew=${jwt.clockSkew}s must be between 0 and ${skewLimit}s.`);
  }
  if (
    jwt?.jwksCacheTtl !== undefined &&
    (typeof jwt.jwksCacheTtl !== 'number' ||
      !Number.isFinite(jwt.jwksCacheTtl) ||
      jwt.jwksCacheTtl <= 0 ||
      jwt.jwksCacheTtl > 600)
  ) {
    throw new Error('webServer.auth.jwtToken.jwksCacheTtl must be between 1 and 600 seconds.');
  }
  if (
    jwt?.jwksCooldown !== undefined &&
    (typeof jwt.jwksCooldown !== 'number' ||
      !Number.isFinite(jwt.jwksCooldown) ||
      jwt.jwksCooldown < 0 ||
      jwt.jwksCooldown > 600)
  ) {
    throw new Error('webServer.auth.jwtToken.jwksCooldown must be between 0 and 600 seconds.');
  }
  if (isProduction && (jwtMode === 'embedded' || jwtMode === 'localKey')) {
    throw new Error(
      `Production HTTP MCP cannot use jwtToken.mode=${jwtMode}. ` +
        'Use mode=remoteJwks with the corporate IdP, or a secret-store opaque service token.',
    );
  }
  if (jwtMode === 'remoteJwks' && !String(jwt?.jwksUri ?? '').trim()) {
    throw new Error('webServer.auth.jwtToken.jwksUri is required for mode=remoteJwks (стандарт Прил. A.1).');
  }
  if (jwtMode === 'remoteJwks' && !isAbsoluteHttpUrl(String(jwt?.jwksUri ?? '').trim())) {
    throw new Error('webServer.auth.jwtToken.jwksUri must be an absolute HTTP(S) URL.');
  }
  if (isProduction && jwtMode === 'remoteJwks' && !isAbsoluteHttpsUrl(String(jwt?.jwksUri ?? '').trim())) {
    throw new Error('webServer.auth.jwtToken.jwksUri must be an absolute HTTPS URL in production.');
  }
  if (jwtMode === 'localKey' && !String(jwt?.publicKeyPath ?? '').trim()) {
    throw new Error('webServer.auth.jwtToken.publicKeyPath is required for mode=localKey.');
  }
  if (jwtMode === 'localKey') {
    assertLocalPublicKey(String(jwt?.publicKeyPath).trim(), jwt?.algorithm);
  }
  if ((jwtMode === 'remoteJwks' || jwtMode === 'localKey') && !String(jwt?.expectedIssuer ?? '').trim()) {
    throw new Error(
      `webServer.auth.jwtToken.expectedIssuer is required for mode=${jwtMode} (стандарт §7.2 / Прил. A.2).`,
    );
  }

  if (!isProduction) {
    return;
  }

  const permanentTokens = Array.isArray(auth.permanentServerTokens)
    ? auth.permanentServerTokens.map((token) => String(token).trim()).filter(Boolean)
    : [];
  const hasValidOpaqueToken = permanentTokens.some(isValidPermanentTokenConfig);
  const legacyJwtActive =
    jwtMode === 'legacyAesCtr' &&
    typeof jwt?.encryptKey === 'string' &&
    jwt.encryptKey.length >= 8 &&
    jwt.encryptKey !== '***';
  if (legacyJwtActive) {
    throw new Error(
      'Production HTTP MCP cannot enable legacyAesCtr/HS256 JWT. ' +
        'Use remoteJwks with RS256 or ES256, or a secret-store opaque service token.',
    );
  }
  const hasAsymmetricJwt = jwtMode === 'remoteJwks';
  if (!hasAsymmetricJwt && !hasValidOpaqueToken) {
    throw new Error(
      'Production HTTP MCP requires corporate remote JWKS or an opaque service token of at least 20 characters.',
    );
  }
}

/** Fail closed for optional developer surfaces before an HTTP production listener is opened. */
export function assertProductionSurfaceSecurity(config: IProductionSurfaceConfig, isProduction: boolean): void {
  if (!isProduction) {
    return;
  }
  if (config.logger?.disableMasking === true) {
    throw new Error('logger.disableMasking must be false in production.');
  }
  const rawAdminAuthType = config.adminPanel?.authType;
  const adminAuthTypes = (Array.isArray(rawAdminAuthType) ? rawAdminAuthType : [rawAdminAuthType]).filter(
    (type) => type && type !== 'none',
  );
  if (config.adminPanel?.enabled === true && adminAuthTypes.length === 0) {
    throw new Error('adminPanel must use an authentication method when enabled in production.');
  }
  if (config.agentTester?.enabled === true && config.agentTester.useAuth !== true) {
    throw new Error('agentTester.useAuth must be true when Agent Tester is enabled in production.');
  }
  if (config.webServer?.metrics?.enabled === true && config.webServer.metrics.requireAuth !== true) {
    throw new Error('webServer.metrics.requireAuth must be true when metrics are enabled in production.');
  }
}
