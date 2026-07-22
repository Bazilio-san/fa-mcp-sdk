/** Authenticated principals must never share task ownership, including case-distinct identities. */
process.env.NODE_CONFIG = JSON.stringify({
  mcp: { tasks: { enabled: true, pollIntervalMs: 5 } },
  webServer: {
    auth: {
      enabled: true,
      permanentServerTokens: ['permanent-owner-token-AAAAAAAA', 'permanent-owner-token-BBBBBBBB'],
      jwtToken: { encryptKey: '***' },
    },
  },
});

import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CreateTaskResultSchema, GetTaskResultSchema, ListTasksResultSchema } from '@modelcontextprotocol/sdk/types.js';

const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';

globalThis.__MCP_PROJECT_DATA__ = {
  agentBrief: 'B',
  agentPrompt: 'P',
  tools: [
    {
      name: 'owned_task',
      description: 'Return an owned task result.',
      inputSchema: { $schema: JSON_SCHEMA, type: 'object', properties: {}, additionalProperties: false },
      execution: { taskSupport: 'required' },
    },
  ],
  toolHandler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
  customAuthValidator: (req) => {
    switch (req.headers['x-custom-principal']) {
      case 'upper':
        return { success: true, username: 'CaseSensitive' };
      case 'lower':
        return { success: true, username: 'casesensitive' };
      case 'binding':
        return { success: true, sessionBinding: 'custom-session-owner' };
      default:
        return { success: false, error: 'Not custom credentials' };
    }
  },
};

const { checkMultiAuth } = await import('../dist/core/auth/multi-auth.js');
const { normalizeAuthPrincipal, transportPrincipal } = await import('../dist/core/auth/principal.js');
const { appConfig } = await import('../dist/core/bootstrap/init-config.js');
const { createMcpServer } = await import('../dist/core/mcp/create-mcp-server.js');
const { resetTaskStore } = await import('../dist/core/mcp/task-store.js');
const { resolveRateLimitKey } = await import('../dist/core/web/rate-limit-key.js');

function authRequest(headers) {
  return { headers, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } };
}

const permanentA = await checkMultiAuth(authRequest({ authorization: 'Bearer permanent-owner-token-AAAAAAAA' }));
const permanentARepeat = await checkMultiAuth(authRequest({ authorization: 'Bearer permanent-owner-token-AAAAAAAA' }));
const permanentB = await checkMultiAuth(authRequest({ authorization: 'Bearer permanent-owner-token-BBBBBBBB' }));
const customUpper = await checkMultiAuth(authRequest({ 'x-custom-principal': 'upper' }));
const customLower = await checkMultiAuth(authRequest({ 'x-custom-principal': 'lower' }));
const customBinding = await checkMultiAuth(authRequest({ 'x-custom-principal': 'binding' }));

for (const invalidIdentity of ['x'.repeat(4097), 'alice\u0007admin']) {
  const normalized = normalizeAuthPrincipal({
    success: true,
    authType: 'jwtToken',
    payload: { sub: invalidIdentity, user: invalidIdentity },
  });
  assert.equal(normalized.success, false, 'invalid authenticated identities must fail closed');
  assert.equal(normalized.principal, undefined, 'invalid identities must never receive a shared owner key');
  assert.throws(
    () => transportPrincipal({ transport: 'http', payload: { sub: invalidIdentity, user: invalidIdentity } }),
    /stable principal identity/,
    'invalid authenticated contexts must not collapse into the anonymous task owner',
  );
}
assert.equal(transportPrincipal({ transport: 'stdio' }), 'anonymous', 'synthetic unauthenticated contexts stay valid');

for (const result of [permanentA, permanentB, customUpper, customLower, customBinding]) {
  assert.equal(result.success, true);
  assert.match(result.principal ?? '', /^[a-zA-Z]+[^:]*:[a-z_]+:[a-f0-9]{64}$/);
}
assert.equal(permanentA.principal, permanentARepeat.principal, 'same credential must have a stable principal');
assert.notEqual(permanentA.principal, permanentB.principal);
assert.notEqual(customUpper.principal, customLower.principal, 'case-distinct principals must remain isolated');
assert.doesNotMatch(permanentA.principal, /AAAA|permanent-owner-token/);

const previousRateLimitScope = appConfig.mcp.rateLimit.scope;
appConfig.mcp.rateLimit.scope = 'subject';
try {
  const rateRequest = (authInfo) => ({ authInfo, ip: '127.0.0.1' });
  assert.equal(
    resolveRateLimitKey(rateRequest({ principal: permanentA.principal })),
    resolveRateLimitKey(rateRequest({ principal: permanentA.principal })),
  );
  assert.notEqual(
    resolveRateLimitKey(rateRequest({ principal: customUpper.principal })),
    resolveRateLimitKey(rateRequest({ principal: customLower.principal })),
  );
  assert.notEqual(
    resolveRateLimitKey(rateRequest({ payload: { sub: 'CaseSensitive' } })),
    resolveRateLimitKey(rateRequest({ payload: { sub: 'casesensitive' } })),
  );
} finally {
  appConfig.mcp.rateLimit.scope = previousRateLimitScope;
}

async function connect(principal, name) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer('http', {
    contextProvider: (_extra, context) => ({ ...context, principal }),
  });
  await server.connect(serverTransport);
  const client = new Client({ name, version: '1.0.0' }, { capabilities: { tasks: {} } });
  await client.connect(clientTransport);
  return { client, server };
}

async function createTask(client) {
  const started = await client.request(
    { method: 'tools/call', params: { name: 'owned_task', arguments: {}, task: {} } },
    CreateTaskResultSchema,
  );
  return started.task.taskId;
}

resetTaskStore();
const owners = await Promise.all([
  connect(permanentA.principal, 'permanent-a'),
  connect(permanentB.principal, 'permanent-b'),
  connect(customUpper.principal, 'custom-upper'),
  connect(customLower.principal, 'custom-lower'),
]);

try {
  const taskId = await createTask(owners[0].client);
  const ownTask = await owners[0].client.request({ method: 'tasks/get', params: { taskId } }, GetTaskResultSchema);
  assert.equal(ownTask.taskId, taskId);

  for (const outsider of owners.slice(1)) {
    const listed = await outsider.client.request({ method: 'tasks/list', params: {} }, ListTasksResultSchema);
    assert.equal(
      listed.tasks.some((task) => task.taskId === taskId),
      false,
    );
    await assert.rejects(
      () => outsider.client.request({ method: 'tasks/get', params: { taskId } }, GetTaskResultSchema),
      (error) => error.code === -32002,
    );
  }

  const upperTaskId = await createTask(owners[2].client);
  await assert.rejects(
    () => owners[3].client.request({ method: 'tasks/get', params: { taskId: upperTaskId } }, GetTaskResultSchema),
    (error) => error.code === -32002,
  );
  console.log('Permanent/custom and case-distinct principals have isolated task ownership.');
} finally {
  await Promise.all(owners.map(({ client }) => client.close()));
  await Promise.all(owners.map(({ server }) => server.close()));
  resetTaskStore();
  delete globalThis.__MCP_PROJECT_DATA__;
}
