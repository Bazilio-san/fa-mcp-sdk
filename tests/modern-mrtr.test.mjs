/**
 * MCP 2026-07-28 — Multi Round-Trip Requests over the v2 handler: `formatInputRequired` from a
 * tool handler → `resultType: "input_required"` with an HMAC-sealed `requestState`; retry with
 * `inputResponses` + echoed state → completion with `inputResponses`/`requestStatePayload` in
 * `IToolHandlerParams`; tampered state → rejected before the handler runs; a client without the
 * `elicitation` capability gets an actionable `isError` text instead of undeliverable requests.
 */
import assert from 'node:assert/strict';

process.env.NODE_CONFIG = JSON.stringify({ mcp: { mrtr: { stateSecret: '0123456789abcdef0123456789abcdef' } } });

const { formatInputRequired } = await import('../dist/core/mcp/v2/mrtr.js');

globalThis.__MCP_PROJECT_DATA__ = {
  tools: [
    {
      name: 'confirm_tool',
      description: 'MRTR demo tool',
      inputSchema: {
        type: 'object',
        properties: { what: { type: 'string' } },
        additionalProperties: false,
      },
    },
  ],
  toolHandler: async (params) => {
    const confirm = params.inputResponses?.confirm;
    const accepted = confirm && confirm.action === 'accept' ? confirm.content : undefined;
    if (!accepted) {
      return formatInputRequired({
        inputRequests: {
          confirm: {
            method: 'elicitation/create',
            params: {
              mode: 'form',
              message: `Confirm ${params.arguments?.what ?? 'operation'}?`,
              requestedSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
            },
          },
        },
        state: { step: 'confirm', nonce: 42 },
      });
    }
    return {
      content: [{ type: 'text', text: `DONE ok=${accepted.ok} state=${JSON.stringify(params.requestStatePayload)}` }],
    };
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
const call = async (extraParams = {}, caps = { elicitation: { form: {} } }) => {
  const body = {
    jsonrpc: '2.0',
    id: ++nextId,
    method: 'tools/call',
    params: {
      name: 'confirm_tool',
      arguments: { what: 'delete' },
      ...extraParams,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'mrtr-test', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': caps,
      },
    },
  };
  const res = await handler.fetch(
    new Request('http://127.0.0.1/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'confirm_tool',
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
};

let mintedState;

await test('first call → resultType input_required with elicitation request and sealed requestState', async () => {
  const { status, json } = await call();
  assert.equal(status, 200);
  const r = json.result;
  assert.equal(r.resultType, 'input_required');
  assert.equal(r.inputRequests.confirm.method, 'elicitation/create');
  assert.equal(r.inputRequests.confirm.params.mode, 'form');
  assert.match(r.requestState, /^v1\./, 'requestState is the codec wire format');
  mintedState = r.requestState;
});

await test('retry with inputResponses + echoed requestState → completion with verified payload', async () => {
  const { status, json } = await call({
    inputResponses: { confirm: { action: 'accept', content: { ok: true } } },
    requestState: mintedState,
  });
  assert.equal(status, 200);
  const r = json.result;
  assert.equal(r.resultType, 'complete');
  assert.notEqual(r.isError, true);
  assert.match(r.content[0].text, /DONE ok=true/);
  assert.match(r.content[0].text, /"step":"confirm"/, 'requestStatePayload restored from the sealed state');
  assert.match(r.content[0].text, /"nonce":42/);
});

await test('tampered requestState → rejected with -32602 before the handler runs', async () => {
  const tampered = `${mintedState.slice(0, -4)}AAAA`;
  const { json } = await call({
    inputResponses: { confirm: { action: 'accept', content: { ok: true } } },
    requestState: tampered,
  });
  assert.equal(json.error?.code, -32602, `expected -32602 rejection, got: ${JSON.stringify(json)}`);
  assert.equal(json.error.data?.reason, 'invalid_request_state');
  assert.doesNotMatch(json.error.message, /step|nonce/, 'rejection must not leak the payload');
});

await test('client without the elicitation capability → actionable isError text, no inputRequests', async () => {
  const { status, json } = await call({}, {});
  assert.equal(status, 200);
  const r = json.result;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /elicitation/);
  assert.equal(r.inputRequests, undefined);
});

await getV2HttpHandler().close();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll modern-mrtr tests passed');
process.exit(0);
