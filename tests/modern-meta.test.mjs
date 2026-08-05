/**
 * MCP 2026-07-28 — per-request `_meta` envelope validation performed by the v2 handler:
 * missing `_meta` / missing required keys → `-32602` (HTTP 400), unknown method → `-32601`
 * (HTTP 404), notifications → HTTP 202 with no body.
 */
import assert from 'node:assert/strict';

import { spawnServer } from './helpers/spawn-server.mjs';
import { modernRpc, modernMeta } from './helpers/modern-rpc.mjs';

const PORT = 19_923;
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
  label: 'modern-meta',
  configOverride: {
    webServer: { auth: { enabled: false } },
    agentTester: { enabled: false },
    adminPanel: { enabled: false },
  },
});
await server.waitReady();

await test('modern header present but no _meta in body → HTTP 400 + -32602', async () => {
  const { status, json } = await modernRpc(BASE, 'tools/list', {}, { meta: null });
  assert.equal(status, 400);
  assert.equal(json.error.code, -32602);
});

await test('_meta without required clientCapabilities → HTTP 400 + -32602', async () => {
  const meta = modernMeta();
  delete meta['io.modelcontextprotocol/clientCapabilities'];
  const { status, json } = await modernRpc(BASE, 'tools/list', {}, { meta });
  assert.equal(status, 400);
  assert.equal(json.error.code, -32602);
});

await test('unknown method with a valid envelope → HTTP 404 + -32601', async () => {
  const { status, json } = await modernRpc(BASE, 'acme/unknown', {});
  assert.equal(status, 404);
  assert.equal(json.error.code, -32601);
});

await test('notification (no id) → HTTP 202 with no body', async () => {
  const { status, text } = await modernRpc(BASE, 'notifications/whatever', {}, { id: null });
  assert.equal(status, 202);
  assert.equal(text, '');
});

server.kill();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll modern-meta tests passed');
