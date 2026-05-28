/**
 * Short-TTL long-running headless tests for Agent Tester API.
 *
 *  Group 4a: with proactive refresh — long run produces zero 401s.
 *  Group 4b: without refresh — eventually 401 after TTL expires.
 *  Group 4c: retry-on-401 — refresh on first 401 then succeed.
 *
 * Uses TTL=8s and clockSkew=0 so we don't have to wait minutes per case.
 *
 * Run after build: node tests/agent-tester-ttl-refresh.test.mjs
 */
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnServer } from './helpers/spawn-server.mjs';

const TEST_PERM_TOKEN = 'test-perm-token-very-long-1234567890';

let port = 39820;
const nextPort = () => port++;

const tmpDirs = [];
function mkTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

process.on('exit', () => {
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TTL_SEC = 8; // short — to surface expiration quickly
const CLOCK_SKEW = 0; // no leniency — expired tokens are genuinely rejected
const TEST_DURATION_MS = 25_000; // 25s = ~3 TTL windows
const REQUEST_INTERVAL_MS = 500; // 50 requests over the window

const baseConfig = (keyDir) => ({
  webServer: {
    auth: {
      enabled: true,
      permanentServerTokens: [TEST_PERM_TOKEN],
      basic: { username: '', password: '' }, // wipe local.yaml basic
      jwtToken: {
        mode: 'embedded',
        algorithm: 'ES256',
        keyStoragePath: keyDir,
        checkMCPName: false,
        clockSkew: CLOCK_SKEW,
      },
    },
  },
  agentTester: { enabled: true, useAuth: true, tokenTTLSec: TTL_SEC },
});

// ════════════════════════════════════════════════════════════════════════════
// 4a — Positive: proactive refresh keeps requests passing
// ════════════════════════════════════════════════════════════════════════════

{
  const srv = spawnServer({ port: nextPort(), configOverride: baseConfig(mkTmp('fa-mcp-ttl-pos-')), label: '4a' });
  await srv.waitReady();

  try {
    // Bootstrap with permanent token to get our first JWT
    const r0 = await fetch(`${srv.url}/agent-tester/api/auth-token`, {
      headers: { Authorization: `Bearer ${TEST_PERM_TOKEN}` },
    });
    assert.strictEqual(r0.status, 200);
    const { token: bearer0, ttlSec } = await r0.json();

    let currentToken = bearer0.replace(/^Bearer /, '');
    let issuedAt = Date.now();
    let refreshCount = 0;
    let success200 = 0;
    let failed401 = 0;

    // Refresh proactively when token is 60% through its lifetime
    async function maybeRefresh() {
      const age = Date.now() - issuedAt;
      if (age > ttlSec * 1000 * 0.6) {
        const r = await fetch(`${srv.url}/agent-tester/api/auth-token/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${currentToken}` },
        });
        if (r.status === 200) {
          const b = await r.json();
          currentToken = b.token.replace(/^Bearer /, '');
          issuedAt = Date.now();
          refreshCount++;
        } else {
          // If refresh failed, fall back to permanent bootstrap
          const r2 = await fetch(`${srv.url}/agent-tester/api/auth-token`, {
            headers: { Authorization: `Bearer ${TEST_PERM_TOKEN}` },
          });
          if (r2.status === 200) {
            const b = await r2.json();
            currentToken = b.token.replace(/^Bearer /, '');
            issuedAt = Date.now();
            refreshCount++;
          }
        }
      }
    }

    const start = Date.now();
    while (Date.now() - start < TEST_DURATION_MS) {
      await maybeRefresh();
      const r = await fetch(`${srv.url}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'example_tool', arguments: { query: 'ping' } },
        }),
      });
      // After Phase 1/2 strict transport: tools/call without a session may return 400/406, but the
      // auth gate runs first — any non-401 means the token was accepted (which is what 4a tests).
      if (r.status === 401) {
        failed401++;
      } else {
        success200++;
      }
      // drain body
      try {
        await r.text();
      } catch {
        /* ignore */
      }
      await sleep(REQUEST_INTERVAL_MS);
    }

    console.log(
      `  → 4a stats: ${success200} non-401 (auth ok), ${failed401} 401, ${refreshCount} refreshes (TTL=${TTL_SEC}s, ` +
        `duration=${((Date.now() - start) / 1000) | 0}s)`,
    );

    assert.ok(success200 >= 20, `expected ≥20 auth-OK requests, got ${success200}`);
    assert.strictEqual(failed401, 0, `expected zero 401s with proactive refresh, got ${failed401}`);
    assert.ok(refreshCount >= 2, `expected ≥2 refreshes over ~3 TTL windows, got ${refreshCount}`);
    console.log('  ✅  4a: proactive refresh — long-running session with TTL=8s yields zero 401s');
  } finally {
    srv.kill();
    await sleep(300);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4b — Negative: no refresh, eventually 401
// ════════════════════════════════════════════════════════════════════════════

{
  const srv = spawnServer({ port: nextPort(), configOverride: baseConfig(mkTmp('fa-mcp-ttl-neg-')), label: '4b' });
  await srv.waitReady();

  try {
    // Get initial token. Decode payload to see actual exp.
    const r0 = await fetch(`${srv.url}/agent-tester/api/auth-token`, {
      headers: { Authorization: `Bearer ${TEST_PERM_TOKEN}` },
    });
    const r0body = await r0.json();
    const { token } = r0body;
    const bearer = token.replace(/^Bearer /, '');
    const payload = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString());
    const lifetimeSec = payload.exp - payload.iat;
    console.log(
      `    issued JWT: ttlSec from response=${r0body.ttlSec}, payload.exp-iat=${lifetimeSec}s, exp ISO=${new Date(payload.exp * 1000).toISOString()}`,
    );

    // Burst 3 requests immediately — auth must pass (non-401). The transport may reject
    // tools/call without a session (400/406), but that's downstream of the auth gate.
    let earlySuccess = 0;
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${srv.url}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'example_tool', arguments: { query: 'ping' } },
        }),
      });
      if (r.status !== 401) {
        earlySuccess++;
      }
      await r.text();
    }
    assert.strictEqual(earlySuccess, 3, `expected 3 early auth-OK results, got ${earlySuccess}`);

    // Wait until well past exp + any possible clockSkew (give 30s leeway in case
    // clockSkew config didn't propagate — keeps test robust)
    const waitSec = lifetimeSec + 35;
    console.log(
      `    iat=${new Date(payload.iat * 1000).toISOString()} exp=${new Date(payload.exp * 1000).toISOString()}`,
    );
    console.log(`    (waiting ${waitSec}s)`);
    const sleepStart = Date.now();
    await sleep(waitSec * 1000);
    const sentAt = Date.now();
    console.log(`    slept ${sentAt - sleepStart}ms, ${((sentAt / 1000) | 0) - payload.exp}s past exp`);

    // Now requests must fail with 401 + WWW-Authenticate. tools/call is not public, so the
    // auth middleware runs and rejects the expired token before transport-level processing.
    const r = await fetch(`${srv.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'example_tool', arguments: { query: 'x' } },
      }),
    });
    const rBody = await r.text();
    console.log(`    final status=${r.status}, body[0..150]=${rBody.substring(0, 150)}`);
    assert.strictEqual(r.status, 401, `expected 401 after TTL expiry, got ${r.status}`);
    const ww = r.headers.get('www-authenticate') || '';
    assert.match(ww, /Bearer/, 'WWW-Authenticate must advertise Bearer');
    assert.match(ww, /resource_metadata=/, 'WWW-Authenticate must reference resource_metadata');
    console.log('  ✅  4b: without refresh — token expires, /mcp returns 401 + WWW-Authenticate');
  } finally {
    srv.kill();
    await sleep(300);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4c — Retry-on-401 pattern
// ════════════════════════════════════════════════════════════════════════════

{
  const srv = spawnServer({ port: nextPort(), configOverride: baseConfig(mkTmp('fa-mcp-ttl-retry-')), label: '4c' });
  await srv.waitReady();

  try {
    let currentToken = null;

    async function getOrRefresh() {
      const r = await fetch(`${srv.url}/agent-tester/api/auth-token`, {
        headers: { Authorization: `Bearer ${TEST_PERM_TOKEN}` },
      });
      const { token } = await r.json();
      currentToken = token.replace(/^Bearer /, '');
    }

    async function callWithRetry() {
      if (!currentToken) {
        await getOrRefresh();
      }
      let r = await fetch(`${srv.url}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
        }),
      });
      if (r.status === 401) {
        await getOrRefresh();
        r = await fetch(`${srv.url}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'example_tool', arguments: { query: 'ping' } },
          }),
        });
      }
      await r.text();
      return r.status;
    }

    // 10 calls spaced by 2s = 20s wall clock, crosses ≥2 TTL boundaries with TTL=8s
    const statuses = [];
    for (let i = 0; i < 10; i++) {
      statuses.push(await callWithRetry());
      await sleep(2000);
    }

    // After Phase 1/2 strict transport: initialize without a session may return 400 even when
    // auth is valid. The retry-on-401 contract is "no terminal 401s after refresh".
    const noFinal401 = statuses.every((s) => s !== 401);
    assert.ok(noFinal401, `expected no terminal 401s after retry, got: ${statuses.join(',')}`);
    console.log(`  ✅  4c: retry-on-401 — all 10 calls auth-OK after refresh (${statuses.length} requests over 20s)`);
  } finally {
    srv.kill();
    await sleep(300);
  }
}

console.log('\nAll TTL refresh tests passed!');
process.exit(0);
