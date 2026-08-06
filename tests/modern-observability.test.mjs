/**
 * MCP 2026-07-28 — request-scoped observability: `notifications/progress` (only with
 * `_meta.progressToken`) and `notifications/message` filtered by the request's own
 * `_meta.io.modelcontextprotocol/logLevel` — a request that omits the field receives no log
 * notifications at all. Both flow on the originating request's own response stream.
 */
import assert from 'node:assert/strict';

process.env.NODE_CONFIG = JSON.stringify({ mcp: { progress: { throttleMs: 0 } } });

globalThis.__MCP_PROJECT_DATA__ = {
  tools: [
    {
      name: 'noisy_tool',
      description: 'emits progress and log messages',
      inputSchema: { type: 'object', additionalProperties: false },
    },
  ],
  toolHandler: async (params) => {
    params.sendProgress?.(1, 2, 'half');
    params.log?.('info', 'informational message', 'tool:noisy_tool');
    params.log?.('debug', 'debug message', 'tool:noisy_tool');
    return { content: [{ type: 'text', text: 'done' }] };
  },
  agentBrief: '',
  agentPrompt: '',
};

const { getV2HttpHandler } = await import('../dist/core/mcp/v2/handler.js');
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

let nextId = 0;
/** Call `noisy_tool` and collect every JSON-RPC message of the response (JSON body or SSE frames). */
const callTool = async (extraMeta = {}) => {
  const res = await handler.fetch(
    new Request('http://127.0.0.1/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'noisy_tool',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++nextId,
        method: 'tools/call',
        params: {
          name: 'noisy_tool',
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            ...extraMeta,
          },
        },
      }),
    }),
  );
  const text = await res.text();
  const messages = [];
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const frame of text.split('\n\n')) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (line) {
        messages.push(JSON.parse(line.slice(5)));
      }
    }
  } else if (text) {
    messages.push(JSON.parse(text));
  }
  return { status: res.status, messages };
};

await test('progressToken present → notifications/progress on this request stream', async () => {
  const { status, messages } = await callTool({ progressToken: 'p-1' });
  assert.equal(status, 200);
  const progress = messages.filter((m) => m.method === 'notifications/progress');
  assert.ok(progress.length >= 1, `expected a progress notification, got: ${JSON.stringify(messages)}`);
  assert.equal(progress[0].params.progressToken, 'p-1');
  assert.equal(progress[0].params.progress, 1);
  assert.equal(progress[0].params.total, 2);
  assert.equal(progress[0].params.message, 'half');
  const final = messages.find((m) => m.result);
  assert.equal(final.result.resultType, 'complete');
});

await test('no progressToken → no progress notifications (plain JSON response)', async () => {
  const { messages } = await callTool();
  assert.equal(messages.filter((m) => m.method === 'notifications/progress').length, 0);
  assert.ok(
    messages.find((m) => m.result),
    'the result is still delivered',
  );
});

await test('logLevel absent → no notifications/message at all (spec requirement)', async () => {
  const { messages } = await callTool({ progressToken: 'p-2' });
  assert.equal(
    messages.filter((m) => m.method === 'notifications/message').length,
    0,
    'a request without logLevel must receive no log notifications',
  );
});

await test('logLevel: info → info delivered, debug filtered out', async () => {
  const { messages } = await callTool({
    progressToken: 'p-3',
    'io.modelcontextprotocol/logLevel': 'info',
  });
  const logs = messages.filter((m) => m.method === 'notifications/message');
  assert.equal(logs.length, 1, `expected exactly the info message, got: ${JSON.stringify(logs)}`);
  assert.equal(logs[0].params.level, 'info');
  assert.equal(logs[0].params.data, 'informational message');
  assert.equal(logs[0].params.logger, 'tool:noisy_tool');
});

await test('logLevel: debug → both messages delivered', async () => {
  const { messages } = await callTool({
    progressToken: 'p-4',
    'io.modelcontextprotocol/logLevel': 'debug',
  });
  const logs = messages.filter((m) => m.method === 'notifications/message');
  assert.equal(logs.length, 2, `expected info + debug, got: ${JSON.stringify(logs)}`);
});

await handler.close();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll modern-observability tests passed');
process.exit(0);
