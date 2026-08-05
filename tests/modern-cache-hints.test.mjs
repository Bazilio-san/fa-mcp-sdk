/**
 * MCP 2026-07-28 — cache hints (`ttlMs` / `cacheScope`) from `mcp.cacheHints` on every cacheable
 * result, the full v2 factory surface (prompts / resources over the shared catalog core), and the
 * deterministic `tools/list` order.
 */
import assert from 'node:assert/strict';

import { spawnServer } from './helpers/spawn-server.mjs';
import { modernRpc } from './helpers/modern-rpc.mjs';

const PORT = 19_924;
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
  label: 'modern-cache-hints',
  configOverride: {
    webServer: { auth: { enabled: false } },
    agentTester: { enabled: false },
    adminPanel: { enabled: false },
    mcp: { cacheHints: { listTtlMs: 5000, readTtlMs: 1000, cacheScope: 'public' } },
  },
});
await server.waitReady();

await test('tools/list carries configured ttlMs/cacheScope and is sorted by name', async () => {
  const { status, json } = await modernRpc(BASE, 'tools/list');
  assert.equal(status, 200);
  const r = json.result;
  assert.equal(r.ttlMs, 5000);
  assert.equal(r.cacheScope, 'public');
  const names = r.tools.map((t) => t.name);
  assert.deepEqual(names, [...names].sort(), `tools must be sorted by name, got: ${names.join(', ')}`);
});

await test('prompts/list served by the v2 factory with cache hints', async () => {
  const { status, json } = await modernRpc(BASE, 'prompts/list');
  assert.equal(status, 200);
  const r = json.result;
  assert.equal(r.resultType, 'complete');
  assert.equal(r.ttlMs, 5000);
  assert.equal(r.cacheScope, 'public');
  assert.ok(
    r.prompts.some((p) => p.name === 'agent_brief'),
    'agent_brief prompt expected',
  );
});

await test('prompts/get returns messages through the shared catalog core', async () => {
  const { status, json } = await modernRpc(BASE, 'prompts/get', { name: 'agent_brief' }, { name: 'agent_brief' });
  assert.equal(status, 200);
  assert.equal(json.result.resultType, 'complete');
  assert.ok(Array.isArray(json.result.messages), 'prompts/get.result.messages expected');
});

await test('resources/list served by the v2 factory with cache hints', async () => {
  const { status, json } = await modernRpc(BASE, 'resources/list');
  assert.equal(status, 200);
  const r = json.result;
  assert.equal(r.ttlMs, 5000);
  assert.equal(r.cacheScope, 'public');
  assert.ok(
    r.resources.some((res) => res.uri === 'project://version'),
    'project://version expected',
  );
});

await test('resources/read carries readTtlMs and contents[]', async () => {
  const { status, json } = await modernRpc(
    BASE,
    'resources/read',
    { uri: 'project://version' },
    { name: 'project://version' },
  );
  assert.equal(status, 200);
  const r = json.result;
  assert.equal(r.resultType, 'complete');
  assert.equal(r.ttlMs, 1000, 'readTtlMs applies to resources/read');
  assert.equal(r.cacheScope, 'public');
  assert.ok(Array.isArray(r.contents) && r.contents[0].uri === 'project://version');
});

await test('resources/read of unknown uri → -32602 (not legacy -32002), clean message', async () => {
  const { json } = await modernRpc(BASE, 'resources/read', { uri: 'staff://nope' }, { name: 'staff://nope' });
  assert.equal(json.error.code, -32602, 'modern era reports resource-not-found as -32602');
  assert.doesNotMatch(json.error.message, /MCP error/, 'no serialization prefix leaks into the message');
});

await test('server/discover advertises prompts+resources capabilities from the factory', async () => {
  const { json } = await modernRpc(BASE, 'server/discover');
  const caps = json.result.capabilities;
  assert.ok(caps.tools, 'tools capability');
  assert.ok(caps.prompts, 'prompts capability');
  assert.ok(caps.resources, 'resources capability');
});

server.kill();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll modern-cache-hints tests passed');
