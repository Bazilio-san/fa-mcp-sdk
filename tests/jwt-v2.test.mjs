/**
 * Tests for the v2 JWT subsystem (RS256/ES256 + JWKS + embedded IdP).
 *
 * Spawns subprocesses with NODE_CONFIG overrides to switch jwtToken.mode at startup.
 * Run after build: node tests/jwt-v2.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

function runSubprocess(name, scenario) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', scenario.code], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_CONFIG: JSON.stringify(scenario.config),
    },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(`  ❌  ${name} — subprocess failed (exit ${result.status})`);
    if (result.error) {
      console.error('     error:', result.error);
    }
    console.error('     stdout:', result.stdout);
    console.error('     stderr:', result.stderr);
    process.exit(1);
  }
  console.log(`  ✅  ${name}`);
}

// ────────────────────────────────────────────────────────────────────────────
// 1. embedded mode: autogen keypair, round-trip sign+verify
// ────────────────────────────────────────────────────────────────────────────

const tmpEmbedded = mkdtempSync(join(tmpdir(), 'fa-mcp-embed-'));
try {
  runSubprocess('embedded mode: autogen keypair + ES256 sign/verify round-trip', {
    config: {
      webServer: {
        auth: {
          enabled: true,
          jwtToken: {
            mode: 'embedded',
            algorithm: 'ES256',
            keyStoragePath: tmpEmbedded,
            checkMCPName: false,
            expectedIssuer: 'urn:test-issuer',
            expectedAudience: 'urn:test-mcp',
          },
        },
      },
    },
    code: `
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateToken, checkJwtToken } from './dist/core/auth/jwt.js';

const token = await generateToken('alice', 60, { scope: 'mcp:read' });
assert.ok(typeof token === 'string', 'token must be a string');
const parts = token.split('.');
assert.strictEqual(parts.length, 3, 'token must be 3 segments');
const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
assert.strictEqual(header.alg, 'ES256', 'expected ES256 alg');
assert.ok(header.kid, 'header must carry kid');

// Files generated on disk
const dir = ${JSON.stringify(tmpEmbedded)};
assert.ok(existsSync(resolve(dir, 'private.pem')), 'private.pem must exist');
assert.ok(existsSync(resolve(dir, 'public.pem')), 'public.pem must exist');

const r = await checkJwtToken({ token });
assert.ok(!r.errorReason, 'expected no error, got: ' + r.errorReason);
assert.strictEqual(r.payload?.user, 'alice');
assert.strictEqual(r.payload?.scope, 'mcp:read');
assert.strictEqual(r.payload?.iss, 'urn:test-issuer');
`,
  });
} finally {
  rmSync(tmpEmbedded, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────────────────
// 2. embedded mode: tampered signature rejected
// ────────────────────────────────────────────────────────────────────────────

const tmpEmbed2 = mkdtempSync(join(tmpdir(), 'fa-mcp-embed-'));
try {
  runSubprocess('embedded mode: tampered signature rejected', {
    config: {
      webServer: {
        auth: {
          enabled: true,
          jwtToken: {
            mode: 'embedded',
            algorithm: 'ES256',
            keyStoragePath: tmpEmbed2,
            checkMCPName: false,
          },
        },
      },
    },
    code: `
import assert from 'node:assert';
import { generateToken, checkJwtToken } from './dist/core/auth/jwt.js';

const token = await generateToken('eve', 60);
const segments = token.split('.');
// flip a char in the signature segment
const sigChars = segments[2].split('');
sigChars[0] = sigChars[0] === 'A' ? 'B' : 'A';
const tampered = segments[0] + '.' + segments[1] + '.' + sigChars.join('');

const r = await checkJwtToken({ token: tampered });
assert.ok(r.errorReason, 'tampered token must fail');
assert.match(r.errorReason, /signature/i, 'expected signature-related error, got: ' + r.errorReason);
`,
  });
} finally {
  rmSync(tmpEmbed2, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────────────────
// 3. embedded mode: expired token rejected with "expired" wording
// ────────────────────────────────────────────────────────────────────────────

const tmpEmbed3 = mkdtempSync(join(tmpdir(), 'fa-mcp-embed-'));
try {
  runSubprocess('embedded mode: expired token rejected', {
    config: {
      webServer: {
        auth: {
          enabled: true,
          jwtToken: {
            mode: 'embedded',
            algorithm: 'ES256',
            keyStoragePath: tmpEmbed3,
            checkMCPName: false,
          },
        },
      },
    },
    code: `
import assert from 'node:assert';
import { generateToken, checkJwtToken } from './dist/core/auth/jwt.js';

// Use -120s — well beyond the default 30s clockSkew so the token is genuinely expired
const token = await generateToken('bob', -120);
const r = await checkJwtToken({ token });
assert.ok(r.errorReason, 'expired must fail');
assert.match(r.errorReason, /expired/i, 'expected "expired", got: ' + r.errorReason);
`,
  });
} finally {
  rmSync(tmpEmbed3, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────────────────
// 4. embedded mode: RS256 round-trip
// ────────────────────────────────────────────────────────────────────────────

const tmpRs = mkdtempSync(join(tmpdir(), 'fa-mcp-rs-'));
try {
  runSubprocess('embedded mode: RS256 sign+verify round-trip', {
    config: {
      webServer: {
        auth: {
          enabled: true,
          jwtToken: {
            mode: 'embedded',
            algorithm: 'RS256',
            keyStoragePath: tmpRs,
            checkMCPName: false,
          },
        },
      },
    },
    code: `
import assert from 'node:assert';
import { generateToken, checkJwtToken } from './dist/core/auth/jwt.js';

const token = await generateToken('alice', 60);
const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
assert.strictEqual(header.alg, 'RS256', 'expected RS256');

const r = await checkJwtToken({ token });
assert.ok(!r.errorReason, 'expected no error, got: ' + r.errorReason);
assert.strictEqual(r.payload?.user, 'alice');
`,
  });
} finally {
  rmSync(tmpRs, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────────────────
// 5. embedded mode: JWKS document exposes public key with kid + alg + use
// ────────────────────────────────────────────────────────────────────────────

const tmpJwks = mkdtempSync(join(tmpdir(), 'fa-mcp-jwks-'));
try {
  runSubprocess('embedded mode: buildLocalJwks publishes correct JWK shape', {
    config: {
      webServer: {
        auth: {
          enabled: true,
          jwtToken: {
            mode: 'embedded',
            algorithm: 'ES256',
            keyStoragePath: tmpJwks,
          },
        },
      },
    },
    code: `
import assert from 'node:assert';
import { buildLocalJwks } from './dist/core/auth/key-resolver.js';

const jwks = await buildLocalJwks();
assert.ok(Array.isArray(jwks.keys), 'jwks.keys must be an array');
assert.strictEqual(jwks.keys.length, 1, 'expected one key');
const k = jwks.keys[0];
assert.strictEqual(k.kty, 'EC', 'expected EC key for ES256');
assert.strictEqual(k.crv, 'P-256');
assert.strictEqual(k.alg, 'ES256');
assert.strictEqual(k.use, 'sig');
assert.ok(k.kid, 'kid required');
// Private fields MUST NOT be present
assert.strictEqual(k.d, undefined, 'private "d" must not leak into JWKS');
`,
  });
} finally {
  rmSync(tmpJwks, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────────────────
// 6. remoteJwks mode: generateToken refuses to issue
// ────────────────────────────────────────────────────────────────────────────

runSubprocess('remoteJwks mode: generateToken refuses to issue with helpful message', {
  config: {
    webServer: {
      auth: {
        enabled: true,
        jwtToken: {
          mode: 'remoteJwks',
          algorithm: 'ES256',
          jwksUri: 'https://idp.example.com/.well-known/jwks.json',
          expectedIssuer: 'https://idp.example.com',
          expectedAudience: 'urn:test',
        },
      },
    },
  },
  code: `
import assert from 'node:assert';
import { generateToken } from './dist/core/auth/jwt.js';
let threw = false;
try {
  await generateToken('alice', 60);
} catch (err) {
  threw = true;
  assert.match(String(err.message), /remoteJwks|not available|IdP/i, 'unexpected error: ' + err.message);
}
assert.ok(threw, 'generateToken must throw in remoteJwks mode');
`,
});

console.log('\nAll jwt-v2 tests passed!');
