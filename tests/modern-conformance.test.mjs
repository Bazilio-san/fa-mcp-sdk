import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedWorker } from './helpers/isolated-worker.mjs';
import { assertSchema } from './helpers/official-schemas.mjs';

const versionKey = 'io.modelcontextprotocol/protocolVersion';
const capsKey = 'io.modelcontextprotocol/clientCapabilities';
const caps = { extensions: { 'io.modelcontextprotocol/tasks': {} }, elicitation: { form: {} } };
let id = 0;
for (const mode of ['http', 'stdio']) {
  await test(`official task schemas and request validation over ${mode}`, async (t) => {
    const worker = await isolatedWorker(mode);
    t.after(() => worker.close());
    const rpc = async (method, params = {}, options = {}) => {
      const body = {
        jsonrpc: '2.0',
        id: ++id,
        method,
        params: {
          ...params,
          _meta: { [versionKey]: '2026-07-28', [capsKey]: caps, ...options.meta },
        },
        ...options.body,
      };
      if (mode === 'stdio') {
        return worker.stdio(body);
      }
      const res = await fetch(`${worker.url}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': body.params?._meta?.[versionKey] ?? '2026-07-28',
          'mcp-method': method,
          'mcp-name': params.taskId ?? params.name ?? params.uri ?? '',
          ...options.headers,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return JSON.parse(
        text.startsWith('event:') || text.startsWith('data:')
          ? text
              .split('\n')
              .find((l) => l.startsWith('data:'))
              .slice(5)
          : text,
      );
    };
    const start = async (name) => {
      const msg = await rpc('tools/call', { name, arguments: {} });
      assertSchema('CreateTaskResult', msg.result);
      assert.equal(msg.result.task, undefined);
      assert.equal(msg.result.ttl, undefined);
      return msg.result.taskId;
    };
    const poll = async (taskId, status) => {
      for (let attempt = 0; attempt < 150; attempt++) {
        const msg = await rpc('tasks/get', { taskId });
        assertSchema('GetTaskResult', msg.result);
        if (msg.result.status === 'completed') {
          assertSchema('CallToolResult', msg.result.result, 'core');
        }
        if (msg.result.status === status) {
          return msg.result;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.fail(`Task did not reach ${status}`);
    };
    const taskId = await start('slow');
    assertSchema('GetTaskResult', (await rpc('tasks/get', { taskId })).result);
    for (const method of ['tasks/get', 'tasks/update', 'tasks/cancel']) {
      const invalid = [
        [{ meta: { [versionKey]: '2099-01-01' } }, -32022],
        [{ body: { jsonrpc: '1.0' } }, -32600],
        [{ body: { id: null } }, -32600],
        [{ body: { id: false } }, -32600],
        [{ body: { id: {} } }, -32600],
        [{ body: { id: undefined } }, -32600],
        [{ body: { params: null } }, -32602],
        [{ body: { params: [] } }, -32602],
        [{ meta: { [capsKey]: [] } }, -32602],
        [{ meta: { [capsKey]: { extensions: true } } }, -32602],
      ];
      for (const [options, code] of invalid) {
        assert.equal((await rpc(method, { taskId }, options)).error?.code, code, JSON.stringify(options));
      }
      assert.equal((await rpc(method, { taskId: 'unknown' })).error?.code, -32602);
      assert.equal((await rpc(method, {})).error?.code, -32602);
      assert.equal((await rpc(method, { taskId }, { meta: { [capsKey]: {} } })).error?.code, -32601);
      if (mode === 'http') {
        for (const headers of [
          { 'mcp-method': 'tools/list' },
          { 'mcp-name': 'wrong' },
          { 'mcp-protocol-version': '2025-11-25' },
        ]) {
          assert.equal((await rpc(method, { taskId }, { headers })).error?.code, -32020);
        }
      }
    }
    const completed = await poll(taskId, 'completed');
    assertSchema('CallToolResult', completed.result, 'core');
    const waitingId = await start('approval');
    await poll(waitingId, 'input_required');
    for (const unsupported of [{ extensions: caps.extensions }, { ...caps, elicitation: { url: {} } }]) {
      const refused = await rpc('tasks/get', { taskId: waitingId }, { meta: { [capsKey]: unsupported } });
      assert.equal(refused.error?.code, -32021);
      assert.equal(refused.result, undefined);
    }
    const ignored = await rpc('tasks/update', { taskId: waitingId, inputResponses: { unknown: {} } });
    assertSchema('UpdateTaskResult', ignored.result);
    await poll(waitingId, 'input_required');
    for (const inputResponses of [undefined, null, [], {}, { approve: 4 }]) {
      assert.equal((await rpc('tasks/update', { taskId: waitingId, inputResponses })).error?.code, -32602);
      await poll(waitingId, 'input_required');
    }
    const update = () =>
      rpc('tasks/update', { taskId: waitingId, inputResponses: { approve: { action: 'accept', content: {} } } });
    const updates = await Promise.all([update(), update()]);
    assert.equal(updates.filter((m) => m.result).length, 1);
    assertSchema('UpdateTaskResult', updates.find((m) => m.result).result);
    await poll(waitingId, 'completed');
    const repeatId = await start('repeat');
    await poll(repeatId, 'input_required');
    await rpc('tasks/update', { taskId: repeatId, inputResponses: { approve: { action: 'accept' } } });
    await poll(repeatId, 'failed');
    const multiId = await start('multi');
    for (let round = 0; round < 2; round++) {
      const waiting = await poll(multiId, 'input_required');
      assert.deepEqual(Object.keys(waiting.inputRequests), [`round-${round}`]);
      await rpc('tasks/update', { taskId: multiId, inputResponses: { [`round-${round}`]: { action: 'accept' } } });
    }
    await poll(multiId, 'completed');
    const twoId = await start('two');
    await poll(twoId, 'input_required');
    const partial = await rpc('tasks/update', { taskId: twoId, inputResponses: { first: { action: 'accept' } } });
    assert.equal(partial.error?.code, -32602);
    await poll(twoId, 'input_required');
    await rpc('tasks/update', {
      taskId: twoId,
      inputResponses: { first: { action: 'accept' }, second: { action: 'decline' } },
    });
    await poll(twoId, 'completed');
    const unsupported = await rpc(
      'tools/call',
      { name: 'approval', arguments: {} },
      {
        meta: { [capsKey]: { extensions: caps.extensions } },
      },
    );
    const unsupportedTask = await poll(unsupported.result.taskId, 'failed');
    assert.equal(unsupportedTask.error.code, -32021);
    const bareForm = await rpc(
      'tools/call',
      { name: 'approval', arguments: {} },
      {
        meta: { [capsKey]: { extensions: caps.extensions, elicitation: {} } },
      },
    );
    await poll(bareForm.result.taskId, 'input_required');
    await rpc('tasks/cancel', { taskId: bareForm.result.taskId });
    const failed = await poll(await start('error'), 'failed');
    assert.equal(failed.error.code, -32602);
    assert.equal(failed.error.data.field, 'query');
    assert.ok(!JSON.stringify(failed).includes('SECRET'));
    assert.equal((await poll(await start('tool_error'), 'completed')).result.isError, true);
    const cancelledId = await start('slow');
    const cancelled = await rpc('tasks/cancel', { taskId: cancelledId });
    assertSchema('CancelTaskResult', cancelled.result);
    assert.equal(cancelled.result.taskId, undefined);
    await poll(cancelledId, 'cancelled');
    for (const uri of ['use://http-headers', 'test://object', 'test://array', 'test://string']) {
      const msg = await rpc('resources/read', { uri });
      assert.equal(typeof msg.result?.contents[0].text, 'string', JSON.stringify(msg));
      if (uri === 'use://http-headers') {
        assert.deepEqual(JSON.parse(msg.result.contents[0].text), [
          { name: 'Authorization', description: 'Synthetic test header' },
        ]);
      }
    }
    assert.ok((await rpc('resources/read', { uri: 'test://binary' })).result.contents[0].blob);
    assert.ok((await rpc('resources/read', { uri: 'test://invalid' })).error);
    if (mode === 'http') {
      const originalFetch = globalThis.fetch;
      const requestIds = [];
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        if (request.method === 'POST') {
          const body = await request.clone().json();
          if (body.method === 'tools/call') {
            requestIds.push(body.id);
          }
        }
        return originalFetch(request);
      };
      t.after(() => {
        globalThis.fetch = originalFetch;
      });
      const { McpModernHttpClient } = await import('../dist/core/utils/testing/McpModernHttpClient.js');
      const client = new McpModernHttpClient(worker.url, { clientCapabilities: caps });
      t.after(() => client.close());
      const args = { inputResponses: 'business-answer', requestState: 'business-state' };
      const ordinary = await client.callTool('echo', args);
      assert.deepEqual(JSON.parse(ordinary.content[0].text).args, args);
      const result = await client.callToolWithInput('echo_input', args, () => ({ approve: { action: 'accept' } }));
      assert.deepEqual(JSON.parse(result.content[0].text).args, args);
      assert.equal(requestIds.length, 3);
      assert.equal(new Set(requestIds).size, requestIds.length);
      globalThis.fetch = originalFetch;
    }
  });
}
