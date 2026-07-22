/**
 * Tests for the JWT subsystem — covers standard signed JWT generation/verification,
 * legacy compatibility and the bearer auth-detection regression.
 *
 * Run after build: node tests/jwt.test.mjs
 */
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import jwt from 'jsonwebtoken';

import {
  generateToken,
  checkJwtToken,
  encrypt as legacyEncrypt,
  standardJwtRE,
  legacyJwtRE,
} from '../dist/core/auth/jwt.js';
import { appConfig } from '../dist/core/bootstrap/init-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const expectedAud = appConfig.name;
const jwtSecret = String(appConfig.webServer?.auth?.jwtToken?.encryptKey || '11111111-7777-8888-9999-000000000000');
const jwtIssuer = appConfig.webServer?.auth?.jwtToken?.issuer;

function signFixtureJwt(payload, options = {}) {
  return jwt.sign(payload, jwtSecret, {
    algorithm: 'HS256',
    ...(jwtIssuer ? { issuer: jwtIssuer } : {}),
    ...options,
  });
}

// ===== 1. Standard JWT: generate → check → ok =====

{
  const token = await generateToken('alice', 60, { service: expectedAud });
  assert.match(token, standardJwtRE, 'token should be a 3-segment standard JWT');
  const result = await checkJwtToken({ token });
  assert.ok(!result.errorReason, `expected no error, got: ${result.errorReason}`);
  assert.strictEqual(result.payload?.sub, 'alice', 'canonical JWT subject must be preserved');
  assert.strictEqual(result.payload?.user, 'alice');
  assert.strictEqual(result.payload?.service, expectedAud);
  assert.ok(result.payload?.jti, 'standard JWT must carry a jti');
  assert.ok(typeof result.payload?.iat === 'string', 'iat must be normalized ISO string');
  assert.ok(
    typeof result.payload?.expire === 'number' && result.payload.expire > Date.now(),
    'expire must be future ms',
  );
  console.log('  ✅  standard JWT: generate → check → ok');
}

// ===== 2. Expired standard JWT → errorReason contains "expired" =====

{
  const token = await generateToken('bob', -10, { service: expectedAud });
  const result = await checkJwtToken({ token });
  assert.ok(result.errorReason, 'expected error for expired token');
  assert.match(result.errorReason, /expired/i, `expected "expired" in error: ${result.errorReason}`);
  console.log('  ✅  expired standard JWT detected');
}

// ===== 3. Tampered standard JWT → "Invalid signature" =====

{
  const token = await generateToken('eve', 60, { service: expectedAud });
  // Flip a character in the signature segment
  const segments = token.split('.');
  const sigChars = segments[2].split('');
  sigChars[0] = sigChars[0] === 'A' ? 'B' : 'A';
  const tampered = `${segments[0]}.${segments[1]}.${sigChars.join('')}`;
  const result = await checkJwtToken({ token: tampered });
  assert.ok(result.errorReason, 'tampered token must fail');
  assert.match(result.errorReason, /signature/i, `expected signature error: ${result.errorReason}`);
  console.log('  ✅  tampered standard JWT rejected with signature error');
}

// ===== 4. Wrong audience with checkMCPName: true → service not match =====

{
  const isCheckMCPName = appConfig.webServer?.auth?.jwtToken?.checkMCPName;
  if (isCheckMCPName) {
    const token = await generateToken('carol', 60, { service: 'unexpected-audience' });
    const result = await checkJwtToken({ token });
    assert.ok(result.errorReason, 'wrong-audience token must fail when checkMCPName=true');
    assert.match(result.errorReason, /service not match/i, `expected service-mismatch error: ${result.errorReason}`);
    console.log('  ✅  wrong audience rejected (service not match)');
  } else {
    console.log('  ⏭️  skipped wrong-audience test (checkMCPName=false in test config)');
  }
}

// ===== 5. Multi-audience standard JWT → ok when expected service is present =====

{
  const token = signFixtureJwt(
    { role: 'operator' },
    {
      subject: 'dave',
      audience: ['unexpected-audience', expectedAud],
      expiresIn: 60,
      jwtid: 'multi-aud-fixture',
    },
  );
  const result = await checkJwtToken({ token });
  assert.ok(!result.errorReason, `expected no error, got: ${result.errorReason}`);
  assert.strictEqual(result.payload?.service, expectedAud);
  console.log('  ✅  multi-audience standard JWT accepted when expected service is present');
}

// ===== 6. Standard JWT without exp → rejected =====

{
  const token = signFixtureJwt(
    { role: 'operator' },
    {
      subject: 'frank',
      audience: expectedAud,
      jwtid: 'missing-exp-fixture',
    },
  );
  const result = await checkJwtToken({ token });
  assert.ok(result.errorReason, 'token without exp must fail');
  assert.match(result.errorReason, /missing expiration/i, `expected missing-exp error: ${result.errorReason}`);
  console.log('  ✅  standard JWT without exp rejected');
}

// ===== 7. Malformed token → "The token is not a JWT" =====

{
  const result = await checkJwtToken({ token: 'definitely-not-a-jwt' });
  assert.ok(result.errorReason, 'malformed token must fail');
  assert.match(result.errorReason, /not a JWT/i, `expected "not a JWT" message: ${result.errorReason}`);
  console.log('  ✅  malformed token rejected');
}

// ===== 7b. Bounded, control-free subjects are required =====

for (const [label, subject] of [
  ['oversized subject', 'x'.repeat(4097)],
  ['control-character subject', 'alice\u0007admin'],
]) {
  const token = signFixtureJwt(
    { role: 'operator' },
    {
      subject,
      audience: expectedAud,
      expiresIn: 60,
      jwtid: `invalid-subject-${label}`,
    },
  );
  const result = await checkJwtToken({ token });
  assert.match(result.errorReason ?? '', /subject is invalid/i, `${label} must fail before authentication succeeds`);
}
await assert.rejects(() => generateToken('x'.repeat(4097), 60), /empty or invalid/i);
await assert.rejects(() => generateToken('alice\u0007admin', 60), /empty or invalid/i);
console.log('  ✅  oversized/control-character standard JWT identities rejected');

// ===== 8. Legacy token fixture → ok =====

{
  // Build a legacy token using the same algorithm `checkLegacyJwt` accepts
  const expire = Date.now() + 60 * 1000;
  const payload = JSON.stringify({
    user: 'legacy-user',
    expire,
    iat: new Date().toISOString(),
    service: expectedAud,
  });
  const encrypted = legacyEncrypt(payload);
  const legacyToken = `${expire}.${encrypted}`;
  assert.match(legacyToken, legacyJwtRE, 'fixture must match legacy format');
  const result = await checkJwtToken({ token: legacyToken });
  assert.ok(!result.errorReason, `legacy token must pass, got: ${result.errorReason}`);
  assert.strictEqual(result.payload?.user, 'legacy-user');
  console.log('  ✅  legacy token fixture accepted');
}

// ===== 8b. Legacy encrypted tokens enforce the same identity bounds =====

for (const [label, user] of [
  ['oversized user', 'x'.repeat(4097)],
  ['control-character user', 'legacy\u0007admin'],
]) {
  const expire = Date.now() + 60 * 1000;
  const encrypted = legacyEncrypt(JSON.stringify({ user, expire, iat: new Date().toISOString() }));
  const result = await checkJwtToken({ token: `${expire}.${encrypted}` });
  assert.match(result.errorReason ?? '', /user identity is invalid/i, `${label} must fail closed`);
}
console.log('  ✅  oversized/control-character legacy encrypted identities rejected');

// ===== 9-11. Revocation scenarios — run in subprocess so NODE_CONFIG injection takes effect =====

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

// We compute revoke list values from the parent process so subprocesses just consume strings.
const tokenForJtiRevoke = await generateToken('rev-jti', 60, { service: expectedAud });
const decodedSegment = JSON.parse(Buffer.from(tokenForJtiRevoke.split('.')[1], 'base64url').toString('utf8'));
const jtiToRevoke = decodedSegment.jti;
assert.ok(jtiToRevoke, 'parent: must have a jti to revoke');

const tokenForExactRevoke = await generateToken('rev-exact', 60, { service: expectedAud });
const legacyTokenForRevoke = (() => {
  const expire = Date.now() + 60 * 1000;
  const pl = JSON.stringify({ user: 'legacy-rev', expire, iat: new Date().toISOString(), service: expectedAud });
  return `${expire}.${legacyEncrypt(pl)}`;
})();

// jti-based revoke
runSubprocess('standard JWT revoke by jti', {
  config: {
    webServer: {
      auth: {
        revoked: { jwtTokens: [{ token: jtiToRevoke }] },
      },
    },
  },
  code: `
import assert from 'node:assert';
import { checkJwtToken } from './dist/core/auth/jwt.js';
const r = await checkJwtToken({ token: ${JSON.stringify(tokenForJtiRevoke)} });
assert.ok(r.errorReason, 'expected revoke error');
assert.match(r.errorReason, /revoked/i, 'expected "revoked" in error: ' + r.errorReason);
`,
});

// exact-match revoke for standard JWT
runSubprocess('standard JWT exact-token revoke', {
  config: {
    webServer: {
      auth: {
        revoked: { jwtTokens: [{ token: tokenForExactRevoke }] },
      },
    },
  },
  code: `
import assert from 'node:assert';
import { checkJwtToken } from './dist/core/auth/jwt.js';
const r = await checkJwtToken({ token: ${JSON.stringify(tokenForExactRevoke)} });
assert.ok(r.errorReason, 'expected revoke error');
assert.match(r.errorReason, /revoked/i, 'expected "revoked": ' + r.errorReason);
`,
});

// legacy full-token revoke
runSubprocess('legacy token revoke by full token', {
  config: {
    webServer: {
      auth: {
        revoked: { jwtTokens: [{ token: legacyTokenForRevoke }] },
      },
    },
  },
  code: `
import assert from 'node:assert';
import { checkJwtToken } from './dist/core/auth/jwt.js';
const r = await checkJwtToken({ token: ${JSON.stringify(legacyTokenForRevoke)} });
assert.ok(r.errorReason, 'expected revoke error');
assert.match(r.errorReason, /revoked/i, 'expected "revoked": ' + r.errorReason);
`,
});

// ===== 12. IP check — denied =====

{
  // We need a token whose payload carries an `ip` field AND a config with isCheckIP=true.
  // Generate token in this process (private claims include `ip`), verify in subprocess with isCheckIP=true.
  const ipToken = await generateToken('ip-user', 60, { service: expectedAud, ip: '10.0.0.0/24' });
  runSubprocess('IP check — wrong client IP denied', {
    config: {
      webServer: { auth: { jwtToken: { isCheckIP: true } } },
    },
    code: `
import assert from 'node:assert';
import { checkJwtToken } from './dist/core/auth/jwt.js';
const r = await checkJwtToken({ token: ${JSON.stringify(ipToken)}, clientIp: '192.168.1.1' });
assert.ok(r.errorReason, 'expected IP error');
assert.match(r.errorReason, /not in the allowed list/i, 'expected IP error: ' + r.errorReason);
`,
  });

  runSubprocess('IP check — allowed client IP passes', {
    config: {
      webServer: { auth: { jwtToken: { isCheckIP: true } } },
    },
    code: `
import assert from 'node:assert';
import { checkJwtToken } from './dist/core/auth/jwt.js';
const r = await checkJwtToken({ token: ${JSON.stringify(ipToken)}, clientIp: '10.0.0.5' });
assert.ok(!r.errorReason, 'expected no error, got: ' + r.errorReason);
assert.strictEqual(r.payload?.user, 'ip-user');
`,
  });
}

// ===== 13. Bearer auth detection — permanent token shaped like JWT must not auto-classify =====

{
  // Smoke-test getTokenFromHttpHeader: a "a.b.c"-shaped credential returns scheme='bearer', not jwt-specific.
  const { getTokenFromHttpHeader } = await import('../dist/core/auth/multi-auth.js');
  const req1 = { headers: { authorization: 'Bearer aaa.bbb.ccc' } };
  const r1 = getTokenFromHttpHeader(req1);
  assert.strictEqual(r1.scheme, 'bearer', 'dotted bearer must be classified as bearer');
  assert.strictEqual(r1.credentials, 'aaa.bbb.ccc');
  assert.strictEqual(r1.looksLikeJwt, true, 'should be flagged as looksLikeJwt');

  const req2 = { headers: { authorization: 'Bearer plain-permanent-token' } };
  const r2 = getTokenFromHttpHeader(req2);
  assert.strictEqual(r2.scheme, 'bearer');
  assert.strictEqual(r2.looksLikeJwt, false);

  const req3 = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
  const r3 = getTokenFromHttpHeader(req3);
  assert.strictEqual(r3.scheme, 'basic');
  console.log('  ✅  bearer auth detection — permanent and JWT bearers both classified as scheme=bearer');
}

console.log('\nAll jwt tests passed!');
