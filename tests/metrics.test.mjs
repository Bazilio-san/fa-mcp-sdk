/**
 * Standard §15.3 — Prometheus metrics endpoint.
 *
 * Boots the template server twice: once with metrics disabled (404 on /metrics) and once
 * enabled (200 + Prometheus text format).
 */
import assert from 'node:assert/strict';

import { spawnServer } from './helpers/spawn-server.mjs';

const PORT_DISABLED = 19_877;
const PORT_ENABLED = 19_878;

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

// --- metrics disabled (default) ---
{
  const server = spawnServer({
    port: PORT_DISABLED,
    label: 'metrics-off',
    configOverride: {
      webServer: {
        auth: { enabled: false },
        metrics: { enabled: false },
      },
      agentTester: { enabled: false },
      adminPanel: { enabled: false },
    },
  });
  await server.waitReady();
  await test('GET /metrics → 404 when disabled (default)', async () => {
    const res = await fetch(`${server.url}/metrics`);
    assert.equal(res.status, 404);
  });
  server.kill();
}

// --- metrics enabled ---
{
  const server = spawnServer({
    port: PORT_ENABLED,
    label: 'metrics-on',
    configOverride: {
      webServer: {
        auth: { enabled: false },
        metrics: { enabled: true, path: '/metrics', includeProcessMetrics: false },
      },
      agentTester: { enabled: false },
      adminPanel: { enabled: false },
    },
  });
  await server.waitReady();
  await test('GET /metrics → 200 Prometheus text/plain when enabled', async () => {
    const res = await fetch(`${server.url}/metrics`);
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type') || '';
    assert.match(ct, /text\/plain/);
    const body = await res.text();
    // Sanity: the SDK custom series must be exposed (counters start at 0 so just check the help line).
    assert.match(body, /mcp_tool_calls_total/);
    assert.match(body, /mcp_auth_failures_total/);
  });
  server.kill();
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll metrics tests passed!');
