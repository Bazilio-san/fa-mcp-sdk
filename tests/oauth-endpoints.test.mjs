/**
 * Integration tests for OAuth / OIDC discovery endpoints + WWW-Authenticate header.
 *
 * Spawns the template HTTP server in mode=embedded on a dedicated port,
 * issues real HTTP requests, asserts shapes, then tears down.
 *
 * Run after build: node tests/oauth-endpoints.test.mjs
 */
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { importPKCS8, SignJWT } from 'jose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const TEST_PORT = 39876;
const TEST_USER = 'testadmin';
const TEST_PASSWORD = 'test-password-123';
const TEST_TOKEN = 'test-permanent-token';
const TEST_ATTACKER_TOKEN = 'test-attacker-token-2';
const tmpKeysDir = mkdtempSync(join(tmpdir(), 'fa-mcp-it-'));

const nodeConfig = {
  webServer: {
    port: TEST_PORT,
    auth: {
      enabled: true,
      permanentServerTokens: [TEST_TOKEN, TEST_ATTACKER_TOKEN],
      jwtToken: {
        mode: 'embedded',
        algorithm: 'ES256',
        keyStoragePath: tmpKeysDir,
        checkMCPName: false,
        expectedIssuer: `http://127.0.0.1:${TEST_PORT}`,
      },
      oauth: {
        resourceUrl: `http://127.0.0.1:${TEST_PORT}/mcp`,
        authorizationServers: [`http://127.0.0.1:${TEST_PORT}`],
        advertisedScopes: ['calendar.read', 'calendar.write', 'calendar.delegate'],
        resourceDocumentationUrl: `http://127.0.0.1:${TEST_PORT}/docs`,
      },
      basic: {
        username: TEST_USER,
        password: TEST_PASSWORD,
      },
    },
    genJwtApiEnable: false,
  },
  // Avoid Consul, AgentTester, AdminPanel — keep startup fast & deterministic
  consul: { service: { enable: false } },
  adminPanel: { enabled: false },
  agentTester: { enabled: false },
};

const serverProc = spawn(process.execPath, [resolve(REPO_ROOT, 'dist/template/start.js')], {
  cwd: REPO_ROOT,
  env: { ...process.env, NODE_CONFIG: JSON.stringify(nodeConfig), NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverStdout = '';
let serverStderr = '';
serverProc.stdout.on('data', (chunk) => {
  serverStdout += chunk.toString();
});
serverProc.stderr.on('data', (chunk) => {
  serverStderr += chunk.toString();
});

async function waitForReady(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) {
        return;
      }
    } catch {
      // The Windows-mounted workspace can make cold ESM startup slow; keep probing the real endpoint.
    }
    if (Date.now() - start > timeoutMs) {
      console.error('Server did not start within', timeoutMs, 'ms');
      console.error('stdout so far:', serverStdout);
      console.error('stderr so far:', serverStderr);
      throw new Error('server-start-timeout');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server-start-timeout');
}

function shutdown() {
  try {
    serverProc.kill('SIGINT');
  } catch {
    /* ignore */
  }
}

process.on('exit', () => {
  shutdown();
  try {
    rmSync(tmpKeysDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
process.on('SIGINT', () => {
  shutdown();
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error(err);
  shutdown();
  process.exit(1);
});

const BASE = `http://127.0.0.1:${TEST_PORT}`;

try {
  await waitForReady();

  // ─── 1. /.well-known/oauth-protected-resource ─────────────────────
  {
    const r = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
    const body = await r.json();
    assert.strictEqual(body.resource, `${BASE}/mcp`, 'resource must identify the canonical MCP endpoint');
    assert.ok(Array.isArray(body.authorization_servers), 'authorization_servers must be array');
    assert.deepStrictEqual(body.authorization_servers, [BASE]);
    assert.ok(Array.isArray(body.bearer_methods_supported), 'bearer_methods_supported required');
    assert.deepStrictEqual(body.scopes_supported, ['calendar.read', 'calendar.write', 'calendar.delegate']);
    assert.strictEqual(body.resource_documentation, `${BASE}/docs`);
    console.log('  ✅  /.well-known/oauth-protected-resource returns valid metadata');
  }

  // ─── 2. /.well-known/openid-configuration (embedded only) ──────────
  {
    const r = await fetch(`${BASE}/.well-known/openid-configuration`);
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
    const body = await r.json();
    assert.ok(body.issuer, 'issuer required');
    assert.ok(
      body.jwks_uri && body.jwks_uri.endsWith('/.well-known/jwks.json'),
      'jwks_uri must point to /.well-known/jwks.json',
    );
    assert.ok(
      body.token_endpoint && body.token_endpoint.endsWith('/oauth/token'),
      'token_endpoint must end with /oauth/token',
    );
    assert.ok(Array.isArray(body.grant_types_supported), 'grant_types_supported required');
    assert.ok(body.grant_types_supported.includes('password'), 'password grant must be advertised');
    assert.ok(Array.isArray(body.id_token_signing_alg_values_supported), 'signing algs required');
    assert.ok(body.id_token_signing_alg_values_supported.includes('ES256'), 'ES256 must be advertised');
    assert.deepStrictEqual(body.scopes_supported, ['calendar.read', 'calendar.write', 'calendar.delegate']);
    console.log('  ✅  /.well-known/openid-configuration returns valid OIDC metadata');
  }

  // ─── 3. /.well-known/jwks.json (embedded only) ─────────────────────
  let jwksKid;
  {
    const r = await fetch(`${BASE}/.well-known/jwks.json`);
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
    const body = await r.json();
    assert.ok(Array.isArray(body.keys), 'keys array required');
    assert.strictEqual(body.keys.length, 1, 'exactly one key for embedded mode');
    const k = body.keys[0];
    assert.strictEqual(k.kty, 'EC', 'EC for ES256');
    assert.strictEqual(k.alg, 'ES256');
    assert.strictEqual(k.use, 'sig');
    assert.ok(k.kid, 'kid required');
    assert.strictEqual(k.d, undefined, 'private "d" must not leak');
    jwksKid = k.kid;
    console.log('  ✅  /.well-known/jwks.json publishes one public key (no private bits)');
  }

  // ─── 4. POST /oauth/token grant_type=password — success ────────────
  let issuedAccessToken;
  {
    const params = new URLSearchParams();
    params.set('grant_type', 'password');
    params.set('username', TEST_USER);
    params.set('password', TEST_PASSWORD);
    params.set('scope', 'calendar.read');

    const r = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
    const body = await r.json();
    assert.ok(body.access_token && typeof body.access_token === 'string', 'access_token required');
    assert.strictEqual(body.token_type, 'Bearer');
    assert.ok(typeof body.expires_in === 'number' && body.expires_in > 0, 'expires_in must be a positive number');

    const header = JSON.parse(Buffer.from(body.access_token.split('.')[0], 'base64url').toString());
    assert.strictEqual(header.alg, 'ES256');
    assert.strictEqual(header.kid, jwksKid, 'token kid must match published jwks.kid');
    issuedAccessToken = body.access_token;
    console.log('  ✅  POST /oauth/token (password grant) issues ES256 JWT with matching kid');
  }

  // ─── 4b. POST /oauth/token rejects unadvertised scopes ─────────────
  {
    const params = new URLSearchParams();
    params.set('grant_type', 'password');
    params.set('username', TEST_USER);
    params.set('password', TEST_PASSWORD);
    params.set('scope', 'mcp:write');
    const r = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    assert.strictEqual(r.status, 400);
    const body = await r.json();
    assert.strictEqual(body.error, 'invalid_scope');
    assert.strictEqual(body.error_description, 'Requested scope is not supported');
    console.log('  ✅  POST /oauth/token rejects scopes not present in advertisedScopes');
  }

  // ─── 5. POST /oauth/token — invalid grant rejected ─────────────────
  {
    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('username', TEST_USER);
    params.set('password', TEST_PASSWORD);

    const r = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    assert.strictEqual(r.status, 400);
    const body = await r.json();
    assert.strictEqual(body.error, 'unsupported_grant_type');
    console.log('  ✅  POST /oauth/token rejects unsupported_grant_type=authorization_code');
  }

  // ─── 6. POST /oauth/token — bad credentials rejected ───────────────
  {
    const params = new URLSearchParams();
    params.set('grant_type', 'password');
    params.set('username', TEST_USER);
    params.set('password', 'wrong-password');

    const r = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    assert.strictEqual(r.status, 401);
    const body = await r.json();
    assert.strictEqual(body.error, 'invalid_grant');
    console.log('  ✅  POST /oauth/token rejects wrong password with invalid_grant');
  }

  // ─── 7. WWW-Authenticate header on 401 with resource_metadata ──────
  {
    const r = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'noop' } }),
    });
    assert.strictEqual(r.status, 401);
    const ww = r.headers.get('www-authenticate') || '';
    assert.match(ww, /^Bearer\b/, 'expected Bearer scheme, got: ' + ww);
    assert.match(ww, /resource_metadata=/, 'resource_metadata must be present, got: ' + ww);
    assert.match(ww, /\/\.well-known\/oauth-protected-resource/, 'must reference protected-resource path: ' + ww);
    assert.doesNotMatch(ww, /error_description|expected|obtained|JOSE/i);
    assert.strictEqual(await r.text(), 'Unauthorized');
    console.log('  ✅  401 on /mcp without token carries WWW-Authenticate with resource_metadata');
  }

  // ─── 7b. Invalid-token diagnostics never escape through 401/header ─
  {
    const r = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer malformed.jwt.value' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'noop' } }),
    });
    assert.strictEqual(r.status, 401);
    const body = await r.text();
    const ww = r.headers.get('www-authenticate') || '';
    assert.strictEqual(body, 'Unauthorized');
    assert.doesNotMatch(`${body} ${ww}`, /expected|obtained|JOSE|signature verification|claim validation/i);
    assert.ok(ww.length < 512, 'WWW-Authenticate must remain bounded');
    console.log('  ✅  invalid-token 401 response and challenge are stable and sanitized');
  }

  // ─── 8. Bearer token issued via /oauth/token authenticates /mcp ────
  // After Phase 1/2 StreamableHTTP transport requires initialize handshake before tools/list.
  // The auth gate is what's under test here — we accept either 200 (full handshake) or 400
  // (auth passed, transport rejects non-initialize without session). Reject 401 strictly.
  {
    const r = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${issuedAccessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });
    assert.notStrictEqual(r.status, 401, `auth must succeed, got 401`);
    assert.ok(r.status === 200 || r.status === 202, `expected 200/202 after auth, got ${r.status}`);
    console.log('  ✅  Bearer token issued via /oauth/token passes /mcp auth gate');
  }

  // ─── 8b. Invalid authenticated identities cannot create an anonymous session ──
  {
    const issuedPayload = JSON.parse(Buffer.from(issuedAccessToken.split('.')[1], 'base64url').toString());
    const privateKey = await importPKCS8(readFileSync(join(tmpKeysDir, 'private.pem'), 'utf8'), 'ES256');
    const invalidTokens = [];
    for (const subject of ['x'.repeat(4097), 'oauth\u0007subject']) {
      invalidTokens.push(
        await new SignJWT({})
          .setProtectedHeader({ alg: 'ES256', kid: jwksKid, typ: 'JWT' })
          .setSubject(subject)
          .setIssuer(issuedPayload.iss)
          .setAudience(issuedPayload.aud)
          .setIssuedAt()
          .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
          .sign(privateKey),
      );
    }

    for (const token of invalidTokens) {
      const response = await fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 8,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bad', version: '0' } },
        }),
      });
      assert.strictEqual(response.status, 401, 'invalid identity must fail before session initialization');
      assert.strictEqual(response.headers.get('mcp-session-id'), null, 'rejected identity must not receive a session');
      assert.strictEqual(await response.text(), 'Unauthorized');
    }
    console.log('  ✅  oversized/control-character identities cannot share an anonymous HTTP session');
  }

  // ─── 9. Permanent token still authenticates (out-of-band path) ─────
  {
    const r = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });
    assert.notStrictEqual(r.status, 401, `auth must succeed, got 401`);
    assert.ok(r.status === 200 || r.status === 202, `expected 200/202 after auth, got ${r.status}`);
    console.log('  ✅  Permanent token (out-of-band) still authenticates /mcp');
  }

  // ─── 10. Stateful sessions are bound to their authenticated owner ──
  {
    const initialize = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'owner', version: '1' } },
      }),
    });
    assert.strictEqual(initialize.status, 200);
    const sessionId = initialize.headers.get('mcp-session-id');
    assert.ok(sessionId, 'initialize must return mcp-session-id');

    const attackerHeaders = {
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${TEST_ATTACKER_TOKEN}`,
      'Mcp-Session-Id': sessionId,
    };
    const crossPost = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { ...attackerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'ping' }),
    });
    assert.strictEqual(crossPost.status, 403, 'another token must not POST into the owner session');

    const crossGet = await fetch(`${BASE}/mcp`, { method: 'GET', headers: attackerHeaders });
    assert.strictEqual(crossGet.status, 403, 'another token must not open the owner event stream');

    const crossDelete = await fetch(`${BASE}/mcp`, { method: 'DELETE', headers: attackerHeaders });
    assert.strictEqual(crossDelete.status, 403, 'another token must not delete the owner session');

    const ownerPing = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Mcp-Session-Id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'ping' }),
    });
    assert.strictEqual(ownerPing.status, 200, 'failed cross-principal DELETE must leave the owner session intact');
    console.log('  ✅  Streamable HTTP session rejects cross-token POST/GET/DELETE and remains owner-accessible');
  }

  // ─── 11. A refreshed JWT for the same principal keeps the session ──
  {
    const initialize = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${issuedAccessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 20,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'jwt-owner', version: '1' } },
      }),
    });
    assert.strictEqual(initialize.status, 200);
    const sessionId = initialize.headers.get('mcp-session-id');
    assert.ok(sessionId, 'JWT initialize must return mcp-session-id');

    const params = new URLSearchParams();
    params.set('grant_type', 'password');
    params.set('username', TEST_USER);
    params.set('password', TEST_PASSWORD);
    params.set('scope', 'calendar.read');
    const refreshed = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    assert.strictEqual(refreshed.status, 200);
    const refreshedToken = (await refreshed.json()).access_token;
    assert.ok(refreshedToken && refreshedToken !== issuedAccessToken, 'refresh fixture must issue a distinct JWT');

    const refreshedPing = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${refreshedToken}`,
        'Mcp-Session-Id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'ping' }),
    });
    assert.strictEqual(refreshedPing.status, 200, 'same-principal JWT rotation must preserve the session');

    const differentPrincipalPing = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TEST_ATTACKER_TOKEN}`,
        'Mcp-Session-Id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 22, method: 'ping' }),
    });
    assert.strictEqual(differentPrincipalPing.status, 403, 'a different principal must remain isolated');
    console.log('  ✅  Streamable HTTP session survives same-principal JWT rotation only');
  }

  console.log('\nAll oauth-endpoints tests passed!');
  shutdown();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
} catch (err) {
  console.error('TEST FAILED:', err);
  shutdown();
  process.exit(1);
}
