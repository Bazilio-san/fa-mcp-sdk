/**
 * MCP 2026-07-28 — dual-era stdio serving: a connection that opens with a modern envelope (or the
 * `server/discover` probe) is served by the v2 entry, while a connection that opens with
 * `initialize` keeps the unchanged legacy path (including the surface only the v1 server
 * registers, e.g. the `logging` capability). The era is decided once per process.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

/** Spawn the template server on stdio, send the given messages, collect the answers by id. */
async function stdioExchange(messages, { timeoutMs = 15_000 } = {}) {
  const proc = spawn(process.execPath, [resolve(REPO_ROOT, 'dist/template/start.js'), 'stdio'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NODE_CONFIG: JSON.stringify({
        consul: { service: { enable: false } },
        adminPanel: { enabled: false },
        agentTester: { enabled: false },
      }),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const byId = new Map();
  let buffer = '';
  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && msg.id !== null) {
          byId.set(msg.id, msg);
        }
      } catch {
        /* non-JSON line on stdout would be a protocol violation; surfaced by the assertions */
      }
    }
  });

  const wantedIds = messages.filter((m) => m.id !== undefined).map((m) => m.id);
  // The server builds its project data on boot; give it a moment before the opening message.
  await new Promise((r) => setTimeout(r, 1500));
  for (const message of messages) {
    proc.stdin.write(`${JSON.stringify(message)}\n`);
    await new Promise((r) => setTimeout(r, 250));
  }

  const deadline = Date.now() + timeoutMs;
  while (wantedIds.some((id) => !byId.has(id)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.stdin.end();
  proc.kill();
  return { byId, stderr };
}

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'stdio-modern-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

await test('modern opening (server/discover) → v2 era: discover + tools/list with resultType', async () => {
  const { byId, stderr } = await stdioExchange([
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: MODERN_META } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: MODERN_META } },
  ]);
  const discover = byId.get(1);
  assert.ok(discover, `no answer to server/discover; stderr: ${stderr.slice(-400)}`);
  assert.equal(discover.result.resultType, 'complete');
  assert.ok(discover.result.supportedVersions.includes('2026-07-28'));
  assert.ok(discover.result._meta['io.modelcontextprotocol/serverInfo']);
  const list = byId.get(2);
  assert.ok(list, 'no answer to tools/list');
  assert.equal(list.result.resultType, 'complete');
  assert.ok(list.result.tools.some((t) => t.name === 'example_tool'));
  assert.match(stderr, /2026-07-28/, 'startup line names the modern revision');
});

await test('modern tools/call over stdio returns a complete result', async () => {
  const { byId } = await stdioExchange([
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: MODERN_META } },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'example_tool', arguments: { query: 'hi' }, _meta: MODERN_META },
    },
  ]);
  const call = byId.get(2);
  assert.ok(call, 'no answer to tools/call');
  assert.equal(call.result.resultType, 'complete');
  assert.notEqual(call.result.isError, true);
});

await test('legacy opening (initialize) → v1 era: handshake, logging capability, no resultType', async () => {
  const { byId, stderr } = await stdioExchange([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'old', version: '1' } },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ]);
  const init = byId.get(1);
  assert.ok(init, `no answer to initialize; stderr: ${stderr.slice(-400)}`);
  assert.equal(init.result.protocolVersion, '2025-11-25');
  assert.ok(init.result.capabilities.logging, 'legacy era keeps the logging capability');
  assert.ok(init.result.serverInfo.name);
  const list = byId.get(2);
  assert.ok(list, 'no answer to tools/list');
  assert.equal(list.result.resultType, undefined, 'resultType must not leak into legacy responses');
  assert.ok(list.result.tools.some((t) => t.name === 'example_tool'));
  assert.match(stderr, /legacy protocol revision/, 'startup line names the legacy era');
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll modern-stdio tests passed');
process.exit(0);
