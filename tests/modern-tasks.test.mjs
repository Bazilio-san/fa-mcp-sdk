/**
 * MCP 2026-07-28 — the Tasks extension (`io.modelcontextprotocol/tasks`) over the v2 handler:
 * advertisement in `server/discover`, unsolicited `CreateTaskResult` (`resultType: "task"`) only
 * toward clients that declared the extension, polling via `tasks/get`, mid-flight input via
 * `tasks/update` (MRTR re-entry), and `tasks/cancel`. `tasks/list` does not exist in the
 * extension.
 */
import assert from 'node:assert/strict';

process.env.NODE_CONFIG = JSON.stringify({
  mcp: {
    tasks: { enabled: true, pollIntervalMs: 25 },
    mrtr: { stateSecret: '0123456789abcdef0123456789abcdef' },
  },
});

const { formatInputRequired } = await import('../dist/core/mcp/v2/mrtr.js');

globalThis.__MCP_PROJECT_DATA__ = {
  tools: [
    {
      name: 'slow_tool',
      description: 'finishes after a short delay',
      inputSchema: { type: 'object', additionalProperties: false },
      execution: { taskSupport: 'optional' },
    },
    {
      name: 'approval_tool',
      description: 'asks for approval mid-task',
      inputSchema: { type: 'object', additionalProperties: false },
      execution: { taskSupport: 'optional' },
    },
  ],
  toolHandler: async (params) => {
    if (params.name === 'slow_tool') {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { content: [{ type: 'text', text: 'SLOW DONE' }] };
    }
    // approval_tool: first round asks for confirmation, second round completes.
    const confirm = params.inputResponses?.approve;
    if (!confirm) {
      return formatInputRequired({
        inputRequests: {
          approve: {
            method: 'elicitation/create',
            params: {
              mode: 'form',
              message: 'Approve?',
              requestedSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
            },
          },
        },
        state: { round: 1 },
      });
    }
    return { content: [{ type: 'text', text: `APPROVED round=${params.requestStatePayload?.round}` }] };
  },
  agentBrief: '',
  agentPrompt: '',
};

const { getV2HttpHandler } = await import('../dist/core/mcp/v2/handler.js');
const { handleModernTaskMethod } = await import('../dist/core/mcp/v2/tasks-methods.js');
const handler = getV2HttpHandler();

let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ❌  ${name}\n      ${err.message}`);
  }
};

const TASKS_CAPS = { extensions: { 'io.modelcontextprotocol/tasks': {} } };
let nextId = 0;
const rpc = async (method, params = {}, { name, caps = TASKS_CAPS } = {}) => {
  const body = {
    jsonrpc: '2.0',
    id: ++nextId,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': caps,
      },
    },
  };
  // Same composition as POST /mcp in server-http.ts: the tasks-extension methods are answered in
  // front of the v2 handler (its closed 2026 method registry rejects the tasks/* names).
  const intercepted = handleModernTaskMethod(body, undefined);
  if (intercepted) {
    return { status: intercepted.status, json: intercepted.json };
  }
  const res = await handler.fetch(
    new Request('http://127.0.0.1/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(name ? { 'mcp-name': name } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
};

const pollUntil = async (taskId, wantedStatus, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { json } = await rpc('tasks/get', { taskId });
    const status = json.result?.status;
    if (status === wantedStatus) {
      return json.result;
    }
    assert.ok(Date.now() < deadline, `timed out waiting for ${wantedStatus}, last: ${JSON.stringify(json)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

await test('server/discover advertises the tasks extension', async () => {
  const { json } = await rpc('server/discover');
  assert.ok(json.result.capabilities.extensions?.['io.modelcontextprotocol/tasks'], 'extension expected');
});

await test('tools/call by a tasks-declaring client → resultType "task", then tasks/get → completed', async () => {
  const { json } = await rpc('tools/call', { name: 'slow_tool', arguments: {} }, { name: 'slow_tool' });
  const r = json.result;
  assert.equal(r.resultType, 'task', `expected a task, got: ${JSON.stringify(json)}`);
  assert.ok(r.task.taskId);
  assert.equal(r.task.status, 'working');
  const done = await pollUntil(r.task.taskId, 'completed');
  assert.match(done.result.content[0].text, /SLOW DONE/);
});

await test('tools/call WITHOUT the extension declared → synchronous result, no task', async () => {
  const { json } = await rpc('tools/call', { name: 'slow_tool', arguments: {} }, { name: 'slow_tool', caps: {} });
  const r = json.result;
  assert.equal(r.resultType, 'complete');
  assert.match(r.content[0].text, /SLOW DONE/);
});

await test('mid-flight input: input_required → tasks/update(inputResponses) → completed', async () => {
  const { json } = await rpc('tools/call', { name: 'approval_tool', arguments: {} }, { name: 'approval_tool' });
  const { taskId } = json.result.task;
  const waiting = await pollUntil(taskId, 'input_required');
  assert.equal(waiting.inputRequests.approve.method, 'elicitation/create');
  const upd = await rpc('tasks/update', {
    taskId,
    inputResponses: { approve: { action: 'accept', content: { ok: true } } },
  });
  assert.ok(!upd.json.error, `tasks/update failed: ${JSON.stringify(upd.json)}`);
  const done = await pollUntil(taskId, 'completed');
  assert.match(done.result.content[0].text, /APPROVED round=1/);
});

await test('tasks/cancel → cancelled; unknown taskId → -32602', async () => {
  const { json } = await rpc('tools/call', { name: 'slow_tool', arguments: {} }, { name: 'slow_tool' });
  const { taskId } = json.result.task;
  const cancelled = await rpc('tasks/cancel', { taskId });
  assert.equal(cancelled.json.result.status, 'cancelled');
  const unknown = await rpc('tasks/get', { taskId: 'nope' });
  assert.equal(unknown.json.error?.code, -32602);
});

await getV2HttpHandler().close();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll modern-tasks tests passed');
process.exit(0);
