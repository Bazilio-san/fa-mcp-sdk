/**
 * MCP 2026-07-28 — `subscriptions/listen`: the acknowledgment comes first and carries the
 * subscription id, opted-in notifications are delivered with `io.modelcontextprotocol/subscriptionId`
 * correlation, and non-opted-in types are not delivered. Exercises the v2 handler in-process via
 * `handler.fetch` (no HTTP spawn) and publishes through the public `mcpNotify` facade.
 */
import assert from 'node:assert/strict';

globalThis.__MCP_PROJECT_DATA__ = {
  tools: [
    {
      name: 'noop_tool',
      description: 'noop',
      inputSchema: { type: 'object', additionalProperties: false },
    },
  ],
  toolHandler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  agentBrief: '',
  agentPrompt: '',
};

const { getV2HttpHandler, mcpNotify } = await import('../dist/core/mcp/v2/handler.js');

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

const handler = getV2HttpHandler();

const listenRequest = () =>
  new Request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'subscriptions/listen',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 77,
      method: 'subscriptions/listen',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'subs-test', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
        notifications: {
          toolsListChanged: true,
          resourceSubscriptions: ['project://version'],
        },
      },
    }),
  });

const res = await handler.fetch(listenRequest());
assert.equal(res.status, 200);
assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

// Single background reader (no read/timer races): every SSE `data:` frame lands in `received`.
const reader = res.body.getReader();
const decoder = new TextDecoder();
const received = [];
let readCursor = 0;
const pump = (async () => {
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (dataLine) {
        received.push(JSON.parse(dataLine.slice(5)));
      }
    }
  }
})().catch(() => {});

/** Wait until at least one unconsumed message is available (or return null on timeout). */
async function nextMessage(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (readCursor >= received.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return readCursor < received.length ? received[readCursor++] : null;
}

await test('first message is notifications/subscriptions/acknowledged with the subscription id', async () => {
  const ack = await nextMessage();
  assert.ok(ack, 'acknowledgment expected');
  assert.equal(ack.method, 'notifications/subscriptions/acknowledged');
  assert.equal(ack.params._meta['io.modelcontextprotocol/subscriptionId'], 77);
  assert.equal(ack.params.notifications.toolsListChanged, true);
  assert.deepEqual(ack.params.notifications.resourceSubscriptions, ['project://version']);
});

await test('mcpNotify.resourceUpdated delivers notifications/resources/updated with correlation', async () => {
  mcpNotify.resourceUpdated('project://version');
  const msg = await nextMessage();
  assert.ok(msg, 'notification expected');
  assert.equal(msg.method, 'notifications/resources/updated');
  assert.equal(msg.params.uri, 'project://version');
  assert.equal(msg.params._meta['io.modelcontextprotocol/subscriptionId'], 77);
});

await test('mcpNotify.toolsChanged delivers notifications/tools/list_changed', async () => {
  mcpNotify.toolsChanged();
  const msg = await nextMessage();
  assert.ok(msg, 'notification expected');
  assert.equal(msg.method, 'notifications/tools/list_changed');
});

await test('non-opted-in types are NOT delivered (promptsListChanged, other resource uris)', async () => {
  mcpNotify.promptsChanged();
  mcpNotify.resourceUpdated('project://other');
  const msg = await nextMessage(800);
  assert.equal(msg, null, `expected silence, got: ${JSON.stringify(msg)}`);
});

await reader.cancel();
await pump;
await getV2HttpHandler().close();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll modern-subscriptions tests passed');
process.exit(0);
