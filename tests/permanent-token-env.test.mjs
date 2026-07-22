import assert from 'node:assert/strict';

const TOKEN = 'single-permanent-token-0123456789';

// Reproduce the production environment-variable path. node-config exposes a
// single WS_SERVER_TOKENS value as a string, not as a one-element array.
process.env.NODE_ENV = 'test';
process.env.WS_AUTH_ENABLED = 'true';
process.env.WS_SERVER_TOKENS = `  ${TOKEN}  `;
process.env.WS_TOKEN_ENCRYPT_KEY = 'single-token-regression-jwt-key';

const { appConfig, normalizePermanentServerTokenString } = await import('../dist/core/bootstrap/init-config.js');
const { checkMultiAuth, detectAuthConfiguration, getAuthHeadersForTests } =
  await import('../dist/core/auth/multi-auth.js');
const { collectAuthProfile } = await import('../dist/core/auth/auth-profile.js');

assert.deepEqual(
  appConfig.webServer.auth.permanentServerTokens,
  [TOKEN],
  'a single WS_SERVER_TOKENS value must normalize to a trimmed one-element array',
);
assert.deepEqual(normalizePermanentServerTokenString(` ${TOKEN}, , second-permanent-token-9876543210, `), [
  TOKEN,
  'second-permanent-token-9876543210',
]);
assert.deepEqual(normalizePermanentServerTokenString(' ,  , '), []);

const detection = detectAuthConfiguration();
assert.deepEqual(
  detection.configured,
  ['permanentServerTokens', 'jwtToken'],
  'permanent-token provider must remain visible when JWT is also configured',
);

const profile = collectAuthProfile();
assert.deepEqual(profile.methods, ['permanentServerTokens', 'jwtToken']);
assert.deepEqual(profile.schemes, ['Bearer']);

assert.deepEqual(await getAuthHeadersForTests(), { Authorization: `Bearer ${TOKEN}` });

const rawAuthResult = await checkMultiAuth({
  headers: { authorization: `Bearer ${TOKEN}` },
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
});
assert.equal(rawAuthResult.success, true, 'the configured opaque Bearer token must authenticate');
assert.equal(rawAuthResult.authType, 'permanentServerTokens');
assert.match(rawAuthResult.principal ?? '', /^permanentServerTokens:token:[a-f0-9]{64}$/);
assert.doesNotMatch(rawAuthResult.principal ?? '', /single-permanent-token/);

console.log('Single WS_SERVER_TOKENS values enable the permanent-token provider and authenticate successfully.');
