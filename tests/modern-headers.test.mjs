/**
 * MCP 2026-07-28 — Streamable HTTP request-header validation performed by the v2 handler:
 * `Mcp-Method` / `Mcp-Name` header-body agreement (`-32020 HeaderMismatch`), unsupported protocol
 * version (`-32022 UnsupportedProtocolVersion`), and the Base64 sentinel encoding of `Mcp-Name`.
 */
import assert from 'node:assert/strict';

import { spawnServer } from './helpers/spawn-server.mjs';
import { modernRpc, modernMeta } from './helpers/modern-rpc.mjs';

const PORT = 19_922;
const BASE = `http://127.0.0.1:${PORT}`;

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

const server = spawnServer({
  port: PORT,
  label: 'modern-headers',
  configOverride: {
    webServer: { auth: { enabled: false } },
    agentTester: { enabled: false },
    adminPanel: { enabled: false },
  },
});
await server.waitReady();

await test('Mcp-Name header ≠ body params.name → HTTP 400 + -32020 HeaderMismatch', async () => {
  const { status, json } = await modernRpc(
    BASE,
    'tools/call',
    { name: 'example_tool', arguments: { query: 'x' } },
    { name: 'WRONG_NAME' },
  );
  assert.equal(status, 400);
  assert.equal(json.error.code, -32020);
});

await test('missing Mcp-Method header → HTTP 400 + -32020 HeaderMismatch', async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 50, method: 'tools/list', params: { _meta: modernMeta() } }),
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, -32020);
});

await test('unsupported protocol version → HTTP 400 + -32022 with data.supported', async () => {
  const { status, json } = await modernRpc(
    BASE,
    'tools/list',
    {},
    {
      headers: { 'mcp-protocol-version': '1999-01-01' },
      meta: modernMeta({ 'io.modelcontextprotocol/protocolVersion': '1999-01-01' }),
    },
  );
  assert.equal(status, 400);
  assert.equal(json.error.code, -32022);
  assert.ok(Array.isArray(json.error.data.supported), 'data.supported lists usable versions');
  assert.equal(json.error.data.requested, '1999-01-01');
});

await test('Mcp-Name in Base64 sentinel encoding is decoded before comparison', async () => {
  const b64 = Buffer.from('example_tool', 'utf8').toString('base64');
  const { status, json } = await modernRpc(
    BASE,
    'tools/call',
    { name: 'example_tool', arguments: { query: 'hello' } },
    { name: `=?base64?${b64}?=` },
  );
  assert.equal(status, 200);
  assert.equal(json.result.resultType, 'complete');
  assert.notEqual(json.result.isError, true);
});

server.kill();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll modern-headers tests passed');
