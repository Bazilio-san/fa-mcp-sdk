/**
 * KeyResolver — uniform interface for obtaining JWT verification keys across modes.
 *
 *  - EmbeddedKeyResolver:  reads / autogenerates a keypair in keyStoragePath
 *  - LocalKeyResolver:     loads a public key (and optional private key) from PEM files
 *  - RemoteJwksKeyResolver: fetches a remote JWKS endpoint with cache & cooldown (jose)
 *
 * Legacy mode (legacyAesCtr) does not use a KeyResolver — verification stays in jwt.ts.
 */

import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { resolve as resolvePath } from 'path';

import chalk from 'chalk';
import { createRemoteJWKSet, exportJWK, exportSPKI, generateKeyPair, importPKCS8, importSPKI } from 'jose';
import type { JWK, JWSHeaderParameters, KeyLike } from 'jose';

import { appConfig } from '../bootstrap/init-config.js';
import { logger as lgr } from '../logger.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('key-resolver') });

export type JwtAsymmetricAlgorithm = 'ES256' | 'RS256';

export interface KeyResolver {
  /** Resolve a verification key for the given JWT header. */
  getVerifyKey(header: JWSHeaderParameters): Promise<KeyLike | Uint8Array>;
  /** Return the signing key + algorithm + kid for token issuance. Throws if mode cannot sign. */
  getSignContext(): { privateKey: KeyLike; algorithm: JwtAsymmetricAlgorithm; kid: string };
  /** Return JWKS (public keys only) for the /.well-known/jwks.json endpoint. */
  getPublicJwks(): { keys: JWK[] };
  /** True if this resolver has access to a private key and can issue tokens. */
  canSign(): boolean;
}

/**
 * Synchronous predicate: can this server issue a JWT locally (sign tokens) with the
 * currently configured jwtToken settings?
 *
 *  - legacyAesCtr: yes if encryptKey is set, ≥8 chars and not the placeholder '***'
 *  - embedded:     yes (keypair auto-generated on first sign call)
 *  - localKey:     yes only if privateKeyPath is configured (presence checked at sign time)
 *  - remoteJwks:   no (tokens come from the external IdP)
 *
 * Used by callers that need to know upfront whether JWT issuance is possible without
 * incurring an async KeyResolver init — e.g. when choosing between issuing a JWT vs.
 * falling back to permanent/basic credentials.
 */
export function canLocallyIssueJwt(): boolean {
  const cfg = getJwtRuntimeConfig();
  const encryptKey = (appConfig.webServer?.auth?.jwtToken?.encryptKey ?? '') as string;
  switch (cfg.mode) {
    case 'legacyAesCtr':
      return typeof encryptKey === 'string' && encryptKey.length >= 8 && encryptKey !== '***';
    case 'embedded':
      return true;
    case 'localKey':
      return Boolean(cfg.privateKeyPath);
    case 'remoteJwks':
      return false;
    default:
      return false;
  }
}

/**
 * Resolve mode + algorithm from config, applying defaults.
 */
export function getJwtRuntimeConfig() {
  const jwt = appConfig.webServer?.auth?.jwtToken;
  const rawMode = jwt?.mode;
  const mode: 'legacyAesCtr' | 'embedded' | 'localKey' | 'remoteJwks' =
    rawMode === 'embedded' || rawMode === 'localKey' || rawMode === 'remoteJwks' ? rawMode : 'legacyAesCtr';
  const algorithm: JwtAsymmetricAlgorithm = jwt?.algorithm === 'RS256' ? 'RS256' : 'ES256';
  return {
    mode,
    algorithm,
    keyStoragePath: jwt?.keyStoragePath || './keys',
    publicKeyPath: jwt?.publicKeyPath || '',
    privateKeyPath: jwt?.privateKeyPath || '',
    jwksUri: jwt?.jwksUri || '',
    expectedIssuer: jwt?.expectedIssuer || '',
    expectedAudience: jwt?.expectedAudience || '',
    jwksCacheTtl: typeof jwt?.jwksCacheTtl === 'number' ? jwt.jwksCacheTtl : 600,
    jwksCooldown: typeof jwt?.jwksCooldown === 'number' ? jwt.jwksCooldown : 30,
    clockSkew: typeof jwt?.clockSkew === 'number' ? jwt.clockSkew : 30,
    defaultTtl: typeof jwt?.defaultTtl === 'number' ? jwt.defaultTtl : 1800,
  };
}

/**
 * Compute a stable `kid` from a JWK (SHA-256 thumbnail, RFC 7638-style first 16 bytes).
 * Not the full RFC 7638 thumbprint, but sufficient and deterministic for our needs.
 */
function deriveKid(jwk: JWK): string {
  // Build a canonical subset and hash it
  const src = jwk as unknown as Record<string, string | undefined>;
  const canonical: Record<string, string> = {};
  for (const key of ['crv', 'e', 'kty', 'n', 'x', 'y'].sort()) {
    const v = src[key];
    if (typeof v === 'string') {
      canonical[key] = v;
    }
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('base64url');
  return hash.substring(0, 16);
}

// ────────────────────────────────────────────────────────────────────────────
// Embedded — autogenerate keypair under keyStoragePath/{private.pem,public.pem}
// ────────────────────────────────────────────────────────────────────────────

class EmbeddedKeyResolver implements KeyResolver {
  private privateKey!: KeyLike;
  private publicKey!: KeyLike;
  private algorithm: JwtAsymmetricAlgorithm;
  private kid!: string;
  private initialized = false;

  constructor(algorithm: JwtAsymmetricAlgorithm) {
    this.algorithm = algorithm;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const { keyStoragePath } = getJwtRuntimeConfig();
    const absDir = resolvePath(keyStoragePath);
    const privPath = resolvePath(absDir, 'private.pem');
    const pubPath = resolvePath(absDir, 'public.pem');

    if (!existsSync(privPath) || !existsSync(pubPath)) {
      logger.info(`Generating embedded ${this.algorithm} keypair at ${absDir}`);
      mkdirSync(absDir, { recursive: true });
      const { privateKey, publicKey } = await generateKeyPair(this.algorithm, { extractable: true });
      const pkcs8 = await exportPrivateKeyPem(privateKey);
      const spki = await exportSPKI(publicKey);
      writeFileSync(privPath, pkcs8, { encoding: 'utf8' });
      try {
        chmodSync(privPath, 0o600);
      } catch {
        // Windows or restricted FS — ignore
      }
      writeFileSync(pubPath, spki, { encoding: 'utf8' });
    }

    const privPem = readFileSync(privPath, 'utf8');
    const pubPem = readFileSync(pubPath, 'utf8');
    this.privateKey = await importPKCS8(privPem, this.algorithm, { extractable: true });
    this.publicKey = await importSPKI(pubPem, this.algorithm, { extractable: true });
    const jwk = await exportJWK(this.publicKey);
    this.kid = deriveKid(jwk);
    this.initialized = true;
    logger.info(`Embedded IdP ready (alg=${this.algorithm}, kid=${this.kid})`);
  }

  async getVerifyKey(_header: JWSHeaderParameters): Promise<KeyLike | Uint8Array> {
    await this.init();
    return this.publicKey;
  }

  getSignContext() {
    if (!this.initialized) {
      throw new Error('EmbeddedKeyResolver not initialized — call init() first');
    }
    return { privateKey: this.privateKey, algorithm: this.algorithm, kid: this.kid };
  }

  getPublicJwks(): { keys: JWK[] } {
    if (!this.initialized) {
      throw new Error('EmbeddedKeyResolver not initialized — call init() first');
    }
    // Cannot be async here — caller must ensure init() has run.
    return { keys: [this.cachedJwk!] };
  }

  // Cached JWK for the public key (populated during init).
  private cachedJwk: JWK | undefined;

  async buildJwks(): Promise<{ keys: JWK[] }> {
    await this.init();
    if (!this.cachedJwk) {
      const jwk = await exportJWK(this.publicKey);
      jwk.kid = this.kid;
      jwk.use = 'sig';
      jwk.alg = this.algorithm;
      this.cachedJwk = jwk;
    }
    return { keys: [this.cachedJwk] };
  }

  canSign(): boolean {
    return true;
  }
}

/**
 * Helper around exportPKCS8 — wraps the awaited PEM string for embedded keypair write.
 */
async function exportPrivateKeyPem(key: KeyLike): Promise<string> {
  const { exportPKCS8 } = await import('jose');
  return exportPKCS8(key);
}

// ────────────────────────────────────────────────────────────────────────────
// LocalKey — public key from disk, optional private key for issuance
// ────────────────────────────────────────────────────────────────────────────

class LocalKeyResolver implements KeyResolver {
  private publicKey!: KeyLike;
  private privateKey: KeyLike | undefined;
  private algorithm: JwtAsymmetricAlgorithm;
  private kid!: string;
  private initialized = false;
  private cachedJwk: JWK | undefined;

  constructor(algorithm: JwtAsymmetricAlgorithm) {
    this.algorithm = algorithm;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const { publicKeyPath, privateKeyPath } = getJwtRuntimeConfig();
    if (!publicKeyPath) {
      throw new Error('jwtToken.publicKeyPath is required for mode=localKey');
    }
    const pubAbs = resolvePath(publicKeyPath);
    if (!existsSync(pubAbs)) {
      throw new Error(`jwtToken.publicKeyPath not found: ${pubAbs}`);
    }
    const pubPem = readFileSync(pubAbs, 'utf8');
    this.publicKey = await importSPKI(pubPem, this.algorithm, { extractable: true });

    if (privateKeyPath) {
      const privAbs = resolvePath(privateKeyPath);
      if (!existsSync(privAbs)) {
        throw new Error(`jwtToken.privateKeyPath not found: ${privAbs}`);
      }
      const privPem = readFileSync(privAbs, 'utf8');
      this.privateKey = await importPKCS8(privPem, this.algorithm, { extractable: true });
    }

    const jwk = await exportJWK(this.publicKey);
    this.kid = deriveKid(jwk);
    jwk.kid = this.kid;
    jwk.use = 'sig';
    jwk.alg = this.algorithm;
    this.cachedJwk = jwk;
    this.initialized = true;
    logger.info(
      `LocalKey resolver ready (alg=${this.algorithm}, kid=${this.kid}, signing=${this.privateKey ? 'on' : 'off'})`,
    );
  }

  async getVerifyKey(_header: JWSHeaderParameters): Promise<KeyLike | Uint8Array> {
    await this.init();
    return this.publicKey;
  }

  getSignContext() {
    if (!this.initialized || !this.privateKey) {
      throw new Error('LocalKey: signing requires jwtToken.privateKeyPath to be configured');
    }
    return { privateKey: this.privateKey, algorithm: this.algorithm, kid: this.kid };
  }

  getPublicJwks(): { keys: JWK[] } {
    if (!this.cachedJwk) {
      throw new Error('LocalKeyResolver not initialized — call init() first');
    }
    return { keys: [this.cachedJwk] };
  }

  async buildJwks(): Promise<{ keys: JWK[] }> {
    await this.init();
    return this.getPublicJwks();
  }

  canSign(): boolean {
    return Boolean(this.privateKey);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// RemoteJwks — fetch JWKS from external IdP (jose handles cache + cooldown)
// ────────────────────────────────────────────────────────────────────────────

class RemoteJwksKeyResolver implements KeyResolver {
  private jwksFn!: ReturnType<typeof createRemoteJWKSet>;
  private initialized = false;

  init(): void {
    if (this.initialized) {
      return;
    }
    const { jwksUri, jwksCacheTtl, jwksCooldown } = getJwtRuntimeConfig();
    if (!jwksUri) {
      throw new Error('jwtToken.jwksUri is required for mode=remoteJwks');
    }
    this.jwksFn = createRemoteJWKSet(new URL(jwksUri), {
      cacheMaxAge: jwksCacheTtl * 1000,
      cooldownDuration: jwksCooldown * 1000,
    });
    this.initialized = true;
    logger.info(`RemoteJwks resolver ready (uri=${jwksUri}, cacheTtl=${jwksCacheTtl}s, cooldown=${jwksCooldown}s)`);
  }

  async getVerifyKey(header: JWSHeaderParameters): Promise<KeyLike | Uint8Array> {
    this.init();
    return (await this.jwksFn(header, {} as any)) as unknown as KeyLike;
  }

  getSignContext(): { privateKey: KeyLike; algorithm: JwtAsymmetricAlgorithm; kid: string } {
    throw new Error(
      `remoteJwks mode does not issue tokens. Obtain a token from the IdP at ${getJwtRuntimeConfig().jwksUri}`,
    );
  }

  getPublicJwks(): { keys: JWK[] } {
    throw new Error('remoteJwks mode does not expose a local JWKS — the IdP publishes it');
  }

  canSign(): boolean {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Factory + module-level singleton (initialized lazily on first use)
// ────────────────────────────────────────────────────────────────────────────

let _resolver: KeyResolver | undefined;
let _resolverMode: string | undefined;

/**
 * Lazily build the singleton resolver for the configured mode.
 * Returns `undefined` for legacy mode (legacy verifier handles it directly).
 */
export async function getKeyResolver(): Promise<KeyResolver | undefined> {
  const { mode, algorithm } = getJwtRuntimeConfig();
  if (mode === 'legacyAesCtr') {
    return undefined;
  }
  if (_resolver && _resolverMode === mode) {
    return _resolver;
  }
  _resolverMode = mode;
  if (mode === 'embedded') {
    const r = new EmbeddedKeyResolver(algorithm);
    await r.init();
    _resolver = r;
  } else if (mode === 'localKey') {
    const r = new LocalKeyResolver(algorithm);
    await r.init();
    _resolver = r;
  } else if (mode === 'remoteJwks') {
    const r = new RemoteJwksKeyResolver();
    r.init();
    _resolver = r;
  }
  return _resolver;
}

/**
 * For tests / hot-reload scenarios. Drops cached resolver so the next call rebuilds it.
 */
export function resetKeyResolverCache(): void {
  _resolver = undefined;
  _resolverMode = undefined;
}

/**
 * Build the public JWKS document for the current resolver. Throws in modes that don't expose one.
 */
export async function buildLocalJwks(): Promise<{ keys: JWK[] }> {
  const resolver = await getKeyResolver();
  if (!resolver) {
    throw new Error('JWKS not available in legacy mode');
  }
  if (resolver instanceof EmbeddedKeyResolver || resolver instanceof LocalKeyResolver) {
    return resolver.buildJwks();
  }
  return resolver.getPublicJwks();
}
