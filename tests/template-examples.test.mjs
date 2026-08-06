/**
 * The template's 2026-07-28 example tools, exercised against a live server with the official
 * reference client: `example_confirm` (multi round-trip confirmation) and the `x-mcp-header`
 * annotation on `example_search` (a parameter mirrored into an HTTP header).
 */
import assert from 'node:assert/strict';

import { spawnServer } from './helpers/spawn-server.mjs';
import { modernRpc } from './helpers/modern-rpc.mjs';

const PORT = 19_926;
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
  label: 'template-examples',
  configOverride: {
    webServer: { auth: { enabled: false } },
    agentTester: { enabled: false },
    adminPanel: { enabled: false },
    mcp: { mrtr: { stateSecret: '0123456789abcdef0123456789abcdef' } },
  },
});
await server.waitReady();

const { McpModernHttpClient } = await import('../dist/core/utils/testing/McpModernHttpClient.js');
const client = new McpModernHttpClient(BASE, {
  clientInfo: { name: 'template-examples', version: '1.0.0' },
  clientCapabilities: { elicitation: { form: {} } },
});

await test('example_search publishes the x-mcp-header annotation in its inputSchema', async () => {
  const { json } = await modernRpc(BASE, 'tools/list');
  const search = json.result.tools.find((t) => t.name === 'example_search');
  assert.ok(search, 'example_search must be advertised');
  assert.equal(search.inputSchema.properties.region['x-mcp-header'], 'Region');
});

await test('a mirrored parameter is accepted when its Mcp-Param header matches the body', async () => {
  const { status, json } = await modernRpc(
    BASE,
    'tools/call',
    { name: 'example_search', arguments: { query: 'invoices', region: 'eu-west' } },
    { name: 'example_search', headers: { 'mcp-param-region': 'eu-west' } },
  );
  assert.equal(status, 200);
  assert.notEqual(json.result.isError, true, `search failed: ${JSON.stringify(json)}`);
});

await test('a mirrored parameter that disagrees with its header → -32020 HeaderMismatch', async () => {
  const { status, json } = await modernRpc(
    BASE,
    'tools/call',
    { name: 'example_search', arguments: { query: 'invoices', region: 'eu-west' } },
    { name: 'example_search', headers: { 'mcp-param-region': 'us-east' } },
  );
  assert.equal(status, 400);
  assert.equal(json.error.code, -32020);
});

await test('example_confirm asks for confirmation, then deletes once the user accepts', async () => {
  let asked = 0;
  const result = await client.callToolWithInput('example_confirm', { target: 'temporary files' }, (requests) => {
    asked += 1;
    assert.ok(requests.confirm, 'the server asks under the `confirm` key');
    assert.equal(requests.confirm.method, 'elicitation/create');
    assert.match(requests.confirm.params.message, /temporary files/);
    return { confirm: { action: 'accept', content: { confirm: true } } };
  });
  assert.equal(asked, 1, 'exactly one confirmation round');
  const payload = result.structuredContent ?? JSON.parse(result.content[0].text);
  assert.equal(payload.deleted, true);
  assert.equal(payload.target, 'temporary files', 'the target is restored from the sealed requestState');
});

await test('example_confirm does not delete when the user declines', async () => {
  const result = await client.callToolWithInput('example_confirm', { target: 'production data' }, () => ({
    confirm: { action: 'decline' },
  }));
  const payload = result.structuredContent ?? JSON.parse(result.content[0].text);
  assert.equal(payload.deleted, false);
  assert.match(payload.reason, /declined/i);
});

await client.close();
server.kill();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll template-example tests passed');
process.exit(0);
