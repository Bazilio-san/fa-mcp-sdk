import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedWorker } from './helpers/isolated-worker.mjs';
import { modernRpc } from './helpers/modern-rpc.mjs';

await test('exact Origin comparison and browser preflight', async (t) => {
  const worker = await isolatedWorker();
  t.after(() => worker.close());
  for (const [origin, status] of [
    [undefined, 200],
    ['https://allowed.example', 200],
    ['http://allowed.example:8080', 200],
    ['https://exact.example:444', 200],
    ['https://exact.example:445', 403],
    ['http://exact.example:444', 403],
    ['https://allowed.example.attacker.test', 403],
    ['https://allowedXexample', 403],
    ['https://user@allowed.example', 403],
    ['https://allowed.example/path', 403],
    ['not a URL', 403],
    ['null', 403],
  ]) {
    const res = await fetch(`${worker.url}/health`, { headers: origin === undefined ? {} : { Origin: origin } });
    assert.equal(res.status, status, origin);
  }
  for (const [origin, status] of [
    ['https://allowed.example', 204],
    ['null', 403],
  ]) {
    const res = await fetch(`${worker.url}/mcp`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization',
      },
    });
    assert.equal(res.status, status);
  }
});

await test('explicit CORS guard disablement', async (t) => {
  const worker = await isolatedWorker('http', { webServer: { auth: { enabled: false }, cors: { enabled: false } } });
  t.after(() => worker.close());
  const res = await fetch(`${worker.url}/health`, { headers: { Origin: 'null' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

const auth = {
  enabled: true,
  permanentServerTokens: ['synthetic-permanent'],
  basic: { username: 'synthetic-user', password: 'synthetic-password' },
  jwtToken: { encryptKey: 'synthetic-encryption-key-0123456789abcdef' },
};
await test('authorization compatibility and custom validator precedence', async (t) => {
  const worker = await isolatedWorker('http', { webServer: { auth } });
  t.after(() => worker.close());
  const basic = Buffer.from('synthetic-user:synthetic-password').toString('base64');
  for (const [authorization, accepted] of [
    ['Bearer synthetic-permanent', true],
    ['bEaReR   synthetic-permanent', true],
    ['Bearer\tsynthetic-permanent', true],
    ['synthetic-permanent', true],
    [`Basic ${basic}`, true],
    [`bAsIc   ${basic}`, true],
    ['Other synthetic-permanent', false],
    ['Bearer synthetic-permanent ignored', false],
    [`Basic ${basic} ignored`, false],
    ['Bearer', false],
    ['Basic', false],
  ]) {
    const r = await modernRpc(
      worker.url,
      'tools/call',
      { name: 'echo', arguments: {} },
      {
        name: 'echo',
        headers: { Authorization: authorization },
      },
    );
    assert.equal(r.status === 200, accepted, authorization);
  }
  const custom = await modernRpc(
    worker.url,
    'tools/call',
    { name: 'echo', arguments: {} },
    {
      name: 'echo',
      headers: { Authorization: 'Malformed ignored extra', 'x-test-subject': 'alice' },
    },
  );
  assert.equal(custom.status, 200);
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': { extensions: { 'io.modelcontextprotocol/tasks': {} } },
  };
  const created = await modernRpc(
    worker.url,
    'tools/call',
    { name: 'slow', arguments: {} },
    {
      name: 'slow',
      meta,
      headers: { 'x-test-subject': 'alice' },
    },
  );
  const { taskId } = created.json.result;
  assert.ok(taskId);
  for (const method of ['tasks/get', 'tasks/update', 'tasks/cancel']) {
    const foreign = await modernRpc(
      worker.url,
      method,
      { taskId },
      {
        name: taskId,
        meta,
        headers: { 'x-test-subject': 'bob' },
      },
    );
    assert.equal(foreign.json.error?.code, -32602);
    assert.equal(foreign.json.result, undefined);
  }
  const own = await modernRpc(
    worker.url,
    'tasks/get',
    { taskId },
    {
      name: taskId,
      meta,
      headers: { 'x-test-subject': 'alice' },
    },
  );
  assert.notEqual(own.json.result.status, 'cancelled');
});

await test('tasks disabled means extension methods do not run', async (t) => {
  const worker = await isolatedWorker('http', { mcp: { tasks: { enabled: false } } });
  t.after(() => worker.close());
  for (const method of ['tasks/get', 'tasks/update', 'tasks/cancel']) {
    const r = await modernRpc(
      worker.url,
      method,
      { taskId: 'unknown' },
      {
        name: 'unknown',
        meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': { extensions: { 'io.modelcontextprotocol/tasks': {} } },
        },
      },
    );
    assert.equal(r.json.error?.code, -32601);
  }
});

for (const reveal of [undefined, '0', 'false', 'arbitrary', '1']) {
  await test(`authorization diagnostic disclosure setting ${reveal ?? 'absent'}`, async (t) => {
    const worker = await isolatedWorker(
      'http',
      { webServer: { auth } },
      {
        DEBUG: 'token:auth',
        ...(reveal === undefined ? {} : { MCP_DEBUG_SHOW_AUTHORIZATION: reveal }),
      },
    );
    t.after(() => worker.close());
    for (const authorization of [
      'Bearer synthetic-denied-bearer',
      'Basic synthetic-denied-basic',
      'Malformed synthetic-denied-header extra',
    ]) {
      const r = await modernRpc(
        worker.url,
        'tools/call',
        { name: 'echo', arguments: {} },
        {
          name: 'echo',
          headers: { aUtHoRiZaTiOn: authorization },
        },
      );
      assert.equal(r.status, 401);
      const output = worker.output();
      assert.equal(output.includes(authorization), reveal === '1');
      if (reveal !== '1') {
        assert.ok(output.includes('[masked]'));
        assert.ok(!output.includes('synthetic-denied-'));
      }
    }
  });
}
