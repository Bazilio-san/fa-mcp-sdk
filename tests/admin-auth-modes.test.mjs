/** Admin JWT validation is mode-aware and never reflects verifier details to the client. */
process.env.NODE_CONFIG = JSON.stringify({
  adminPanel: { enabled: true, authType: 'jwtToken' },
  // Keep this unit test on the SDK's stderr logger so exercising a rejected admin credential
  // does not initialize the long-lived rotating file logger used by an actual HTTP process.
  mcp: { transportType: 'stdio' },
  webServer: {
    auth: {
      enabled: true,
      jwtToken: {
        mode: 'remoteJwks',
        algorithm: 'ES256',
        jwksUri: 'https://idp.example.test/.well-known/jwks.json',
        expectedIssuer: 'https://idp.example.test',
        checkMCPName: true,
      },
    },
  },
});

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { appConfig } = await import('../dist/core/bootstrap/init-config.js');
const { createAdminAuthMW, validateAdminAuthConfig } = await import('../dist/core/auth/admin-auth.js');
const { generateToken } = await import('../dist/core/auth/jwt.js');

assert.equal(validateAdminAuthConfig(), null, 'remote JWKS admin auth must not require a legacy encryptKey');

appConfig.webServer.auth.jwtToken = { mode: 'legacyAesCtr', encryptKey: '***', checkMCPName: true };
assert.match(validateAdminAuthConfig() ?? '', /encryptKey is missing or too short/);

const keyDir = mkdtempSync(join(tmpdir(), 'fa-mcp-admin-auth-'));
try {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicKeyPath = join(keyDir, 'public.pem');
  writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));

  appConfig.webServer.auth.jwtToken = {
    mode: 'localKey',
    algorithm: 'ES256',
    publicKeyPath,
    expectedIssuer: 'urn:local-admin-test',
  };
  assert.equal(validateAdminAuthConfig(), null);

  appConfig.webServer.auth.jwtToken = {
    mode: 'localKey',
    algorithm: 'ES256',
    publicKeyPath: join(keyDir, 'missing.pem'),
    expectedIssuer: 'urn:local-admin-test',
  };
  assert.match(validateAdminAuthConfig() ?? '', /readable publicKeyPath/);
} finally {
  rmSync(keyDir, { recursive: true, force: true });
}

const CLAIM_SECRET = 'private-obtained-service.example.test';
appConfig.webServer.auth.jwtToken = {
  mode: 'legacyAesCtr',
  encryptKey: 'admin-auth-test-key-0123456789',
  checkMCPName: true,
};
assert.equal(validateAdminAuthConfig(), null);
const mismatchedServiceToken = await generateToken('private-admin-user', 60, {
  allow: 'gen-token',
  service: CLAIM_SECRET,
});

const req = { headers: { authorization: `Bearer ${mismatchedServiceToken}` } };
const res = {
  statusCode: 200,
  body: undefined,
  headers: {},
  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
};
let nextCalled = false;
for (const middleware of createAdminAuthMW()) {
  await middleware(req, res, () => {
    nextCalled = true;
  });
  if (res.statusCode !== 200 || nextCalled) {
    break;
  }
}
assert.equal(nextCalled, false);
assert.equal(res.statusCode, 401);
assert.match(res.body.error, /^Authentication failed\./);
assert.doesNotMatch(JSON.stringify(res.body), /private-admin-user|private-obtained-service|Expected|obtained/i);

console.log('Admin JWT validation follows active mode and keeps verifier details internal.');
