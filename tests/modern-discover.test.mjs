/**
 * MCP 2026-07-28 — `server/discover`, catalog/call over the v2 stateless handler, and the
 * sessionful legacy path regression (dual-era serving on one endpoint).
 */
import assert from 'node:assert/strict';

import { spawnServer } from './helpers/spawn-server.mjs';
import { modernRpc, MODERN_VERSION } from './helpers/modern-rpc.mjs';

const PORT = 19_921;
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
  label: 'modern-discover',
  configOverride: {
    webServer: { auth: { enabled: false } },
    agentTester: { enabled: false },
    adminPanel: { enabled: false },
  },
});
await server.waitReady();

await test('server/discover → resultType, supportedVersions, capabilities, serverInfo, cache hints', async () => {
  const { status, json } = await modernRpc(BASE, 'server/discover');
  assert.equal(status, 200);
  const r = json.result;
  assert.equal(r.resultType, 'complete');
  assert.ok(r.supportedVersions.includes(MODERN_VERSION));
  assert.ok(r.capabilities.tools, 'tools capability expected');
  assert.equal(r.ttlMs, 60_000, 'listTtlMs default from mcp.cacheHints');
  assert.equal(r.cacheScope, 'private');
  const serverInfo = r._meta['io.modelcontextprotocol/serverInfo'];
  assert.ok(serverInfo?.name, 'serverInfo.name expected');
  assert.ok(serverInfo?.version, 'serverInfo.version expected');
});

await test('tools/list → tools with raw JSON Schema, resultType, cache hints', async () => {
  const { status, json } = await modernRpc(BASE, 'tools/list');
  assert.equal(status, 200);
  const r = json.result;
  assert.equal(r.resultType, 'complete');
  assert.equal(r.ttlMs, 60_000);
  assert.equal(r.cacheScope, 'private');
  const tool = r.tools.find((t) => t.name === 'example_tool');
  assert.ok(tool, 'example_tool expected in tools/list');
  assert.equal(tool.inputSchema.type, 'object');
  assert.ok(tool.inputSchema.properties.query, 'raw JSON Schema published verbatim');
});

await test('tools/call (valid args) → resultType complete + serverInfo stamped', async () => {
  const { status, json } = await modernRpc(
    BASE,
    'tools/call',
    { name: 'example_tool', arguments: { query: 'hello' } },
    { name: 'example_tool' },
  );
  assert.equal(status, 200);
  assert.equal(json.result.resultType, 'complete');
  assert.notEqual(json.result.isError, true);
  assert.ok(json.result._meta['io.modelcontextprotocol/serverInfo']);
});

await test('tools/call (schema violation) → isError:true with field diagnostics (standard §9.4)', async () => {
  const { status, json } = await modernRpc(
    BASE,
    'tools/call',
    { name: 'example_tool', arguments: { bogus: 1 } },
    { name: 'example_tool' },
  );
  assert.equal(status, 200, 'validation failure is a tool result, not an HTTP error');
  assert.equal(json.result.isError, true);
  const [{ text }] = json.result.content;
  assert.match(text, /query/, 'diagnostic names the missing field');
});

await test('legacy sessionful path still works: initialize → session id → tools/list', async () => {
  const init = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 900,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } },
    }),
  });
  assert.equal(init.status, 200);
  const sid = init.headers.get('mcp-session-id');
  assert.ok(sid, 'initialize must mint an Mcp-Session-Id');
  const list = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': sid,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 901, method: 'tools/list', params: {} }),
  });
  assert.equal(list.status, 200);
  const text = await list.text();
  assert.match(text, /example_tool/);
  assert.doesNotMatch(text, /resultType/, 'resultType must not leak into legacy-era responses');
});

await test('sessionless legacy tools/list is served statelessly (no 400)', async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 902, method: 'tools/list', params: {} }),
  });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /example_tool/);
});

server.kill();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll modern-discover tests passed');
