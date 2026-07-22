/**
 * Streamable HTTP compatibility: catalog list requests are allowed without an MCP session.
 *
 * Run after build: node tests/streamable-http-sessionless-list.test.mjs
 */
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const SERVER_ENTRY = resolve(__dirname, 'fixtures/sessionless-list-server.mjs');

let port = 39950;
const nextPort = () => port++;

function parseRpcMessages(raw) {
  const out = [];
  const tryPush = (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      out.push(...parsed);
    } else {
      out.push(parsed);
    }
  };

  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    tryPush(raw);
    return out;
  }

  let dataLines = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5));
    } else if (!line.trim() && dataLines.length > 0) {
      tryPush(dataLines.join('\n'));
      dataLines = [];
    }
  }
  if (dataLines.length > 0) {
    tryPush(dataLines.join('\n'));
  }

  return out;
}

async function postMcp(srv, method, params = {}) {
  const response = await fetch(`${srv.url}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${method}-1`,
      method,
      params,
    }),
  });
  const text = await response.text();
  return { response, text, messages: parseRpcMessages(text) };
}

async function withServer(label, config, fn) {
  const serverPort = nextPort();
  const fullConfig = {
    webServer: { port: serverPort, ...config.webServer },
    consul: { service: { enable: false } },
    adminPanel: { enabled: false },
    agentTester: { enabled: false },
    ...config,
  };
  if (config.webServer) {
    fullConfig.webServer = { ...config.webServer, port: serverPort };
  }

  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_CONFIG: JSON.stringify(fullConfig), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const srv = {
    url: `http://127.0.0.1:${serverPort}`,
    kill: () => {
      try {
        proc.kill('SIGINT');
      } catch {
        /* ignore */
      }
    },
    getStderr: () => stderr,
    getStdout: () => stdout,
  };

  const waitReady = async (timeoutMs = 45000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (proc.exitCode !== null) {
        throw new Error(`server exited with code ${proc.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }
      try {
        const health = await fetch(`${srv.url}/health`);
        if (health.status === 200) {
          return;
        }
      } catch {
        /* not listening yet */
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`server did not become healthy within ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  };

  try {
    await waitReady();
    await fn(srv);
    console.log(`  ✅  ${label}`);
  } catch (err) {
    console.error(`  ❌  ${label}`);
    console.error('  stdout:', srv.getStdout().split('\n').slice(-8).join('\n'));
    console.error('  stderr:', srv.getStderr().split('\n').slice(-8).join('\n'));
    srv.kill();
    throw err;
  } finally {
    srv.kill();
    await new Promise((r) => setTimeout(r, 200));
  }
}

await withServer(
  'catalog list requests do not require MCP-Session-Id',
  {
    webServer: { auth: { enabled: false } },
    agentTester: { enabled: false },
  },
  async (srv) => {
    for (const [method, resultKey] of [
      ['tools/list', 'tools'],
      ['prompts/list', 'prompts'],
      ['resources/list', 'resources'],
    ]) {
      const { response, messages, text } = await postMcp(srv, method);
      assert.strictEqual(response.status, 200, `${method} expected HTTP 200, got ${response.status}: ${text}`);
      assert.strictEqual(response.headers.get('mcp-session-id'), null, `${method} must not create a session`);
      assert.ok(messages.length >= 1, `${method} must return at least one JSON-RPC message`);
      assert.strictEqual(messages[0].id, `${method}-1`);
      assert.ok(Array.isArray(messages[0].result?.[resultKey]), `${method} must return result.${resultKey}[]`);
    }
  },
);

await withServer(
  'tools/call still requires initialize/session',
  {
    webServer: { auth: { enabled: false } },
    agentTester: { enabled: false },
  },
  async (srv) => {
    const { response, messages, text } = await postMcp(srv, 'tools/call', { name: 'echo', arguments: {} });
    assert.strictEqual(response.status, 400, `tools/call expected HTTP 400, got ${response.status}: ${text}`);
    assert.strictEqual(messages[0].error?.code, -32600);
    assert.match(messages[0].error?.message ?? '', /initialize|session/i);
  },
);

console.log('\nAll streamable-http-sessionless-list tests passed!');
process.exit(0);
