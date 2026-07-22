/** Authentication must finish before any dynamic prompt/resource provider can execute. */
process.env.NODE_CONFIG = JSON.stringify({
  webServer: {
    auth: {
      enabled: true,
      permanentServerTokens: ['provider-ordering-token-0123456789'],
      jwtToken: { encryptKey: '***' },
    },
  },
});

import assert from 'node:assert/strict';

let promptProviderCalls = 0;
let resourceProviderCalls = 0;
let customAuthForbidden = false;
globalThis.__MCP_PROJECT_DATA__ = {
  tools: [],
  toolHandler: async () => ({ content: [] }),
  agentBrief: 'B',
  agentPrompt: 'P',
  customAuthValidator: () =>
    customAuthForbidden
      ? { success: false, forbidden: true, error: 'Policy denied' }
      : { success: false, error: 'Credentials not provided' },
  customPrompts: async () => {
    promptProviderCalls += 1;
    return [
      {
        name: 'dynamic_public_prompt',
        description: 'Would be public only after provider execution.',
        arguments: [],
        content: 'private until authenticated',
        requireAuth: false,
      },
    ];
  },
  customResources: async () => {
    resourceProviderCalls += 1;
    return [
      {
        uri: 'dynamic://public',
        name: 'dynamic-public-resource',
        description: 'Would be public only after provider execution.',
        mimeType: 'text/plain',
        content: 'private until authenticated',
        requireAuth: false,
      },
    ];
  },
};

const { createAuthMW, getMultiAuthError } = await import('../dist/core/auth/middleware.js');

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

async function invoke(method, params, authorization) {
  const req = {
    path: '/mcp',
    body: { jsonrpc: '2.0', id: 1, method, params },
    headers: authorization ? { authorization } : {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = mockResponse();
  let nextCalled = false;
  await createAuthMW()(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
}

for (const [method, params] of [
  ['prompts/get', { name: 'dynamic_public_prompt' }],
  ['resources/read', { uri: 'dynamic://public' }],
]) {
  const missing = await invoke(method, params);
  assert.equal(missing.nextCalled, false);
  assert.equal(missing.res.statusCode, 401);

  const invalid = await invoke(method, params, 'Bearer invalid-provider-ordering-credential');
  assert.equal(invalid.nextCalled, false);
  assert.equal(invalid.res.statusCode, 401);
}
assert.equal(promptProviderCalls, 0, 'auth middleware must not execute dynamic prompt providers');
assert.equal(resourceProviderCalls, 0, 'auth middleware must not execute dynamic resource providers');

customAuthForbidden = true;
const forbidden = await getMultiAuthError({
  headers: {},
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
});
assert.deepEqual(forbidden, { code: 403, message: 'Forbidden' });

delete globalThis.__MCP_PROJECT_DATA__;
console.log('Authentication precedes dynamic providers and programmatic forbidden results remain 403.');
