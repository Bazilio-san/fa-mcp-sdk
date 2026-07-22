import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertHttpAuthPreflight,
  assertProductionSurfaceSecurity,
} from '../dist/core/bootstrap/production-preflight.js';
import { appConfig } from '../dist/core/bootstrap/init-config.js';
import { getJwtRuntimeConfig } from '../dist/core/auth/key-resolver.js';

const productionOAuth = {
  resourceUrl: 'https://mcp.example.test/mcp',
  authorizationServers: ['https://identity.example.test/'],
  resourceDocumentationUrl: 'https://mcp.example.test/docs',
  advertisedScopes: ['calendar.read'],
};

assert.doesNotThrow(() =>
  assertProductionSurfaceSecurity(
    {
      logger: { disableMasking: false },
      adminPanel: { enabled: true, authType: 'jwtToken' },
      agentTester: { enabled: true, useAuth: true },
    },
    true,
  ),
);
assert.doesNotThrow(() =>
  assertProductionSurfaceSecurity(
    {
      logger: { disableMasking: true },
      adminPanel: { enabled: true, authType: 'none' },
      agentTester: { enabled: true, useAuth: false },
    },
    false,
  ),
);

assert.throws(
  () => assertProductionSurfaceSecurity({ logger: { disableMasking: true } }, true),
  /disableMasking must be false/,
);

const inactiveInvalidAuth = {
  enabled: false,
  jwtToken: {
    mode: 'remoteJwks',
    algorithm: 'invalid-while-disabled',
    jwksUri: '',
    expectedIssuer: '',
    userClaim: 'sub',
    clockSkew: 999,
    jwksCacheTtl: 0,
  },
  oauth: {
    resourceUrl: 'not-an-absolute-url',
    authorizationServers: ['not-an-absolute-url'],
    advertisedScopes: ['invalid scope'],
  },
};

assert.doesNotThrow(() => assertHttpAuthPreflight(inactiveInvalidAuth, false));
assert.throws(
  () => assertHttpAuthPreflight(inactiveInvalidAuth, true),
  /webServer\.auth\.enabled must be true for production HTTP MCP servers/,
);
for (const [field, value, expected] of [
  ['clockSkew', Number.NaN, /clockSkew/],
  ['clockSkew', Number.POSITIVE_INFINITY, /clockSkew/],
  ['jwksCacheTtl', Number.NaN, /jwksCacheTtl/],
  ['jwksCooldown', Number.NaN, /jwksCooldown/],
]) {
  assert.throws(
    () =>
      assertHttpAuthPreflight(
        { enabled: true, jwtToken: { mode: 'legacyAesCtr', encryptKey: '***', [field]: value } },
        false,
      ),
    expected,
  );
}

const jwtConfig = appConfig.webServer.auth.jwtToken;
const previousNumericConfig = {
  clockSkew: jwtConfig.clockSkew,
  jwksCacheTtl: jwtConfig.jwksCacheTtl,
  jwksCooldown: jwtConfig.jwksCooldown,
  defaultTtl: jwtConfig.defaultTtl,
};
try {
  jwtConfig.clockSkew = Number.NaN;
  jwtConfig.jwksCacheTtl = Number.NaN;
  jwtConfig.jwksCooldown = Number.NaN;
  jwtConfig.defaultTtl = Number.NaN;
  const runtime = getJwtRuntimeConfig();
  assert.equal(runtime.clockSkew, 30);
  assert.equal(runtime.jwksCacheTtl, 600);
  assert.equal(runtime.jwksCooldown, 30);
  assert.equal(runtime.defaultTtl, 1800);
} finally {
  Object.assign(jwtConfig, previousNumericConfig);
}
assert.throws(
  () =>
    assertHttpAuthPreflight(
      {
        enabled: true,
        jwtToken: { mode: 'remoteJwks', algorithm: 'ES256', jwksUri: '', expectedIssuer: '' },
      },
      false,
    ),
  /jwksUri is required for mode=remoteJwks/,
);
for (const userClaim of [
  'iss',
  'sub',
  'aud',
  'exp',
  'nbf',
  'iat',
  'jti',
  'user',
  'expire',
  'service',
  'ip',
  'scope',
  'allow',
]) {
  assert.throws(
    () =>
      assertHttpAuthPreflight(
        { enabled: true, jwtToken: { mode: 'legacyAesCtr', encryptKey: '***', userClaim } },
        false,
      ),
    /userClaim must be a non-reserved/,
  );
}
assert.doesNotThrow(() =>
  assertHttpAuthPreflight(
    {
      enabled: true,
      jwtToken: { mode: 'legacyAesCtr', encryptKey: '***', userClaim: 'preferred_username' },
    },
    false,
  ),
);
assert.throws(
  () =>
    assertHttpAuthPreflight(
      {
        enabled: true,
        jwtToken: { mode: 'remoteJwks', jwksUri: 'not-a-url', expectedIssuer: 'https://idp.example' },
      },
      false,
    ),
  /jwksUri must be an absolute HTTP\(S\) URL/,
);
assert.throws(
  () =>
    assertHttpAuthPreflight(
      {
        enabled: true,
        jwtToken: {
          mode: 'remoteJwks',
          jwksUri: 'http://idp.example/.well-known/jwks.json',
          expectedIssuer: 'https://idp.example',
        },
        oauth: productionOAuth,
      },
      true,
    ),
  /jwksUri must be an absolute HTTPS URL in production/,
);
assert.doesNotThrow(() =>
  assertHttpAuthPreflight(
    {
      enabled: true,
      jwtToken: {
        mode: 'remoteJwks',
        jwksUri: 'https://idp.example/.well-known/jwks.json',
        expectedIssuer: 'https://idp.example',
      },
      oauth: productionOAuth,
    },
    true,
  ),
);
for (const [name, oauth, expected] of [
  ['missing resource URL', { ...productionOAuth, resourceUrl: '' }, /resourceUrl must be an explicit absolute HTTPS/],
  [
    'plaintext resource URL',
    { ...productionOAuth, resourceUrl: 'http://mcp.example.test/mcp' },
    /resourceUrl must be an explicit absolute HTTPS/,
  ],
  [
    'missing authorization server',
    { ...productionOAuth, authorizationServers: [] },
    /authorizationServers must contain at least one explicit absolute HTTPS/,
  ],
  [
    'plaintext authorization server',
    { ...productionOAuth, authorizationServers: ['http://identity.example.test/'] },
    /authorizationServers must contain at least one explicit absolute HTTPS/,
  ],
  [
    'plaintext documentation URL',
    { ...productionOAuth, resourceDocumentationUrl: 'http://mcp.example.test/docs' },
    /resourceDocumentationUrl must be an absolute HTTPS/,
  ],
]) {
  assert.throws(
    () =>
      assertHttpAuthPreflight(
        {
          enabled: true,
          jwtToken: {
            mode: 'remoteJwks',
            algorithm: 'ES256',
            jwksUri: 'https://identity.example.test/.well-known/jwks.json',
            expectedIssuer: 'https://identity.example.test/',
          },
          oauth,
        },
        true,
      ),
    expected,
    name,
  );
}
for (const mode of ['embedded', 'localKey']) {
  assert.throws(
    () =>
      assertHttpAuthPreflight(
        {
          enabled: true,
          permanentServerTokens: ['production-opaque-token-0123456789'],
          jwtToken: { mode },
          oauth: productionOAuth,
        },
        true,
      ),
    new RegExp(`cannot use jwtToken\\.mode=${mode}`),
  );
}

const keyDir = mkdtempSync(join(tmpdir(), 'fa-mcp-preflight-'));
try {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicKeyPath = join(keyDir, 'public.pem');
  const malformedKeyPath = join(keyDir, 'malformed.pem');
  writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(malformedKeyPath, 'not a key');
  assert.doesNotThrow(() =>
    assertHttpAuthPreflight(
      {
        enabled: true,
        jwtToken: { mode: 'localKey', algorithm: 'ES256', publicKeyPath, expectedIssuer: 'urn:test' },
      },
      false,
    ),
  );
  assert.throws(
    () =>
      assertHttpAuthPreflight(
        {
          enabled: true,
          jwtToken: {
            mode: 'localKey',
            algorithm: 'ES256',
            publicKeyPath: malformedKeyPath,
            expectedIssuer: 'urn:test',
          },
        },
        false,
      ),
    /readable, parseable public key compatible with ES256/,
  );
} finally {
  rmSync(keyDir, { recursive: true, force: true });
}
assert.doesNotThrow(() =>
  assertHttpAuthPreflight(
    {
      enabled: true,
      permanentServerTokens: ['production-opaque-token-0123456789'],
      jwtToken: { mode: 'legacyAesCtr', encryptKey: '***' },
    },
    true,
  ),
);
assert.throws(
  () => assertProductionSurfaceSecurity({ adminPanel: { enabled: true, authType: 'none' } }, true),
  /adminPanel must use an authentication method/,
);
assert.throws(
  () => assertProductionSurfaceSecurity({ agentTester: { enabled: true, useAuth: false } }, true),
  /agentTester\.useAuth must be true/,
);
assert.throws(
  () => assertProductionSurfaceSecurity({ webServer: { metrics: { enabled: true, requireAuth: false } } }, true),
  /metrics\.requireAuth must be true/,
);
assert.doesNotThrow(() =>
  assertProductionSurfaceSecurity({ webServer: { metrics: { enabled: true, requireAuth: true } } }, true),
);

console.log('Production preflight tests passed');
