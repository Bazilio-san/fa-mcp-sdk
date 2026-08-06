/**
 * Dual-era serving on one endpoint — the migration's central promise.
 *
 * Drives the server with the OFFICIAL reference clients of both generations at the same time:
 * `@modelcontextprotocol/client` v2 (protocol revision 2026-07-28, no handshake, per-request
 * `_meta`) and the v1 SDK client (2025-11-25 handshake + `Mcp-Session-Id` session). Also covers
 * the transport-contract scenarios `tests/README.md` used to list as untested: session round-trip,
 * `202` for notifications, `GET`/`DELETE /mcp`, and interleaved traffic from both eras.
 */
import assert from 'node:assert/strict';

import { spawnServer } from './helpers/spawn-server.mjs';

const PORT = 19_925;
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
  label: 'dual-era',
  configOverride: {
    webServer: { auth: { enabled: false } },
    agentTester: { enabled: false },
    adminPanel: { enabled: false },
  },
});
await server.waitReady();

const { McpModernHttpClient } = await import('../dist/core/utils/testing/McpModernHttpClient.js');
const { Client: LegacyClient } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport: LegacyTransport } =
  await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

// --- modern client (official v2 package) ---
const modern = new McpModernHttpClient(BASE, { clientInfo: { name: 'dual-era-modern', version: '1.0.0' } });

await test('modern reference client: server/discover reports the 2026-07-28 revision', async () => {
  const result = await modern.discover();
  assert.ok(result.supportedVersions.includes('2026-07-28'));
  assert.ok(result.capabilities.tools);
  assert.equal(modern.protocolEra, 'modern', 'the client settled on the modern era');
});

await test('modern reference client: tools/list and tools/call', async () => {
  const list = await modern.listTools();
  assert.ok(list.tools.some((t) => t.name === 'example_tool'));
  const call = await modern.callTool('example_tool', { query: 'dual era' });
  assert.notEqual(call.isError, true, `tool call failed: ${JSON.stringify(call)}`);
});

// --- legacy client (v1 SDK package), same endpoint, at the same time ---
const legacyClient = new LegacyClient({ name: 'dual-era-legacy', version: '1.0.0' }, { capabilities: {} });
const legacyTransport = new LegacyTransport(new URL('/mcp', BASE));

await test('legacy reference client: initialize handshake mints a session', async () => {
  await legacyClient.connect(legacyTransport);
  assert.ok(legacyTransport.sessionId, 'the server must mint an Mcp-Session-Id on initialize');
  const version = legacyClient.getServerVersion();
  assert.ok(version?.name, 'serverInfo is reported by the handshake');
});

await test('legacy reference client: tools/list and tools/call over its session', async () => {
  const list = await legacyClient.listTools();
  assert.ok(list.tools.some((t) => t.name === 'example_tool'));
  const call = await legacyClient.callTool({ name: 'example_tool', arguments: { query: 'legacy era' } });
  assert.notEqual(call.isError, true, `legacy tool call failed: ${JSON.stringify(call)}`);
});

await test('both eras interleave on one endpoint without interfering', async () => {
  const [modernList, legacyList, modernCall, legacyCall] = await Promise.all([
    modern.listTools(),
    legacyClient.listTools(),
    modern.callTool('example_tool', { query: 'interleaved modern' }),
    legacyClient.callTool({ name: 'example_tool', arguments: { query: 'interleaved legacy' } }),
  ]);
  assert.ok(modernList.tools.length > 0 && legacyList.tools.length > 0);
  assert.notEqual(modernCall.isError, true);
  assert.notEqual(legacyCall.isError, true);
  // Each client stays in its own era: the modern one runs sessionless on 2026-07-28, the legacy
  // one keeps its negotiated session. (`resultType` is wire-level bookkeeping that both reference
  // clients strip while decoding, so it is asserted on the raw wire in modern-discover.test.mjs.)
  assert.equal(modern.protocolEra, 'modern');
  assert.equal(legacyClient.getNegotiatedProtocolVersion?.() ?? '2025-11-25', '2025-11-25');
  assert.ok(legacyTransport.sessionId, 'the legacy client still holds its session');
});

// --- raw transport-contract scenarios (the gaps tests/README.md listed as untested) ---

await test('legacy session id is required after initialize: a stale id is rejected', async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': 'stale-session-that-never-existed',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.ok(res.status >= 400, `a stale session must be rejected, got HTTP ${res.status}`);
});

await test('modern notification (no id) → HTTP 202 with an empty body', async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'notifications/progress',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: {
        progressToken: 'x',
        progress: 1,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
  assert.equal(res.status, 202);
  assert.equal((await res.text()).trim(), '');
});

await test('GET /mcp without a session is refused (no standalone stream in 2026-07-28)', async () => {
  const res = await fetch(`${BASE}/mcp`, { method: 'GET', headers: { accept: 'text/event-stream' } });
  assert.ok(res.status >= 400, `expected a refusal, got HTTP ${res.status}`);
});

await test('DELETE /mcp terminates the legacy session', async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'DELETE',
    headers: { 'mcp-session-id': legacyTransport.sessionId },
  });
  assert.ok(res.status < 500, `session teardown must not fail server-side, got HTTP ${res.status}`);
});

await modern.close();
await legacyClient.close().catch(() => {});
server.kill();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll dual-era tests passed');
process.exit(0);
