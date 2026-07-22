/**
 * Standard §15.1 — `X-Request-Id` middleware behaviour.
 *
 * Boots the template server with metrics off + auth off so /health is reachable, then
 * confirms the response always carries an `X-Request-Id`, that a valid client-supplied id
 * is echoed verbatim, and that an invalid one is replaced.
 */
import assert from 'node:assert/strict';

import { spawnServer } from './helpers/spawn-server.mjs';

const PORT = 19_876;

const server = spawnServer({
  port: PORT,
  label: 'request-id',
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

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

await test('/health is dependency-independent liveness with the canonical body', async () => {
  const res = await fetch(`${server.url}/health`);
  const id = res.headers.get('x-request-id');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.version, 'string');
  assert.equal(typeof body.uptime, 'number');
  assert.deepEqual(Object.keys(body).sort(), ['status', 'uptime', 'version']);
  assert.ok(id, 'X-Request-Id header must be present');
  assert.match(id, REQUEST_ID_RE);
});

await test('valid client-supplied X-Request-Id is echoed verbatim', async () => {
  const supplied = 'client-correlation-12345';
  const res = await fetch(`${server.url}/health`, { headers: { 'X-Request-Id': supplied } });
  assert.equal(res.headers.get('x-request-id'), supplied);
});

await test('invalid X-Request-Id is replaced by a generated id', async () => {
  const bad = '!!!has spaces & nope';
  const res = await fetch(`${server.url}/health`, { headers: { 'X-Request-Id': bad } });
  const id = res.headers.get('x-request-id');
  assert.notEqual(id, bad);
  assert.match(id, REQUEST_ID_RE);
});

await test('tracestate is echoed back unchanged', async () => {
  const ts = 'vendor1=value1,vendor2=value2';
  const res = await fetch(`${server.url}/health`, { headers: { tracestate: ts } });
  assert.equal(res.headers.get('tracestate'), ts);
});

await test('valid traceparent is accepted (no echo, no header pollution)', async () => {
  const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
  const res = await fetch(`${server.url}/health`, { headers: { traceparent: tp } });
  // We never echo traceparent — only tracestate.
  assert.equal(res.headers.get('traceparent'), null);
  // Sanity: still get a request id.
  assert.match(res.headers.get('x-request-id'), REQUEST_ID_RE);
});

server.kill();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll request-id tests passed!');
