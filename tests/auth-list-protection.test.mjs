import assert from 'node:assert/strict';

// Config must be set before importing the SDK: auth mode is intentionally fixed at process startup.
process.env.NODE_ENV = 'production';
process.env.NODE_CONFIG = JSON.stringify({
  webServer: {
    auth: {
      enabled: true,
      permanentServerTokens: ['test-service-token-0123456789'],
    },
  },
});

const { createAuthMW } = await import('../dist/core/auth/middleware.js');

function mockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
  };
}

async function invoke(method, authorization) {
  const req = {
    path: '/mcp',
    body: { jsonrpc: '2.0', id: 1, method, params: {} },
    headers: authorization ? { authorization } : {},
    ip: '127.0.0.1',
  };
  const res = mockResponse();
  let nextCalled = false;
  await createAuthMW()(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

const initialize = await invoke('initialize');
assert.equal(initialize.nextCalled, false, 'initialize must require authentication before creating a session');
assert.equal(initialize.res.statusCode, 401);
assert.equal(initialize.res.body, 'Unauthorized');
assert.ok(initialize.res.headers['www-authenticate']);

const invalidInitialize = await invoke('initialize', 'Bearer expected-secret-obtained-value');
assert.equal(invalidInitialize.nextCalled, false, 'initialize with explicit invalid credentials must be rejected');
assert.equal(invalidInitialize.res.statusCode, 401);
assert.equal(invalidInitialize.res.body, 'Unauthorized');

for (const method of ['tools/list', 'prompts/list', 'resources/list']) {
  const { res, nextCalled } = await invoke(method);
  assert.equal(nextCalled, false, `${method} must not reach the MCP transport without authentication`);
  assert.equal(res.statusCode, 401, `${method} must require credentials when auth is enabled`);
  assert.equal(res.body, 'Unauthorized');
  assert.ok(res.headers['www-authenticate'], `${method} must include a WWW-Authenticate challenge`);
}

const invalid = await invoke('tools/list', 'Bearer expected-secret-obtained-value');
assert.equal(invalid.res.statusCode, 401);
assert.equal(invalid.res.body, 'Unauthorized');
assert.doesNotMatch(
  `${invalid.res.body} ${invalid.res.headers['www-authenticate']}`,
  /expected|obtained|signature|JOSE|test-service-token/i,
);

console.log('Authenticated catalog-list protection test passed.');
process.exit(0);
