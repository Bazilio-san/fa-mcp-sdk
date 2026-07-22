import assert from 'node:assert/strict';

process.env.NODE_CONFIG = JSON.stringify({
  webServer: {
    auth: {
      enabled: true,
      permanentServerTokens: [],
      basic: { username: 'basic-user', password: 'basic-password' },
      jwtToken: { encryptKey: '***' },
    },
  },
});

globalThis.__MCP_PROJECT_DATA__ = {
  customAuthValidator: (req) => {
    switch (req.headers['x-test-case']) {
      case 'missing-identity':
        return { success: true, authType: 'custom' };
      case 'username':
        return { success: true, authType: 'jwtToken', username: 'service-a' };
      case 'payload':
        return { success: true, payload: { sub: 'service-b' } };
      case 'binding':
        return { success: true, sessionBinding: 'service-c' };
      case 'oversized':
        return { success: true, username: 'x'.repeat(1025) };
      case 'control':
        return { success: true, payload: { sub: 'service\u0007admin' } };
      case 'forbidden':
        return { success: false, forbidden: true, error: 'Policy denied' };
      default:
        return { success: false, error: 'No custom credentials' };
    }
  },
};

const { checkMultiAuth } = await import('../dist/core/auth/multi-auth.js');

function request(testCase) {
  return {
    headers: { 'x-test-case': testCase },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
}

const missingIdentity = await checkMultiAuth(request('missing-identity'));
assert.equal(missingIdentity.success, false);
assert.equal(missingIdentity.authType, 'custom');
assert.match(missingIdentity.error ?? '', /stable principal identity/);

for (const testCase of ['username', 'payload', 'binding']) {
  const result = await checkMultiAuth(request(testCase));
  assert.equal(result.success, true, `${testCase} should provide a stable custom principal`);
  assert.equal(result.authType, 'custom', 'custom validators cannot spoof another authentication type');
}

for (const testCase of ['oversized', 'control']) {
  const result = await checkMultiAuth(request(testCase));
  assert.equal(result.success, false, `${testCase} custom identity must fail closed`);
  assert.equal(result.authType, 'custom');
  assert.match(result.error ?? '', /stable principal identity/);
}

const basicCredentials = Buffer.from('basic-user:basic-password').toString('base64');
const basic = await checkMultiAuth({
  headers: { authorization: `Basic ${basicCredentials}` },
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
});
assert.equal(basic.success, true, 'valid Basic authentication must remain compatible');
assert.equal(basic.authType, 'basic');
assert.match(basic.principal ?? '', /^basic:user:[a-f0-9]{64}$/);

const forbidden = await checkMultiAuth(request('forbidden'));
assert.equal(forbidden.success, false);
assert.equal(forbidden.forbidden, true);
assert.equal(forbidden.authType, 'custom');

console.log('Custom authentication identity tests passed.');
