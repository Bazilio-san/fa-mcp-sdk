/**
 * Test helper: spawn the template HTTP server in a subprocess with a config override.
 * Returns { url, kill, waitReady } for the test to use.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

export function spawnServer({ port, configOverride, label = 'server' }) {
  const fullConfig = {
    webServer: { port, ...configOverride.webServer },
    consul: { service: { enable: false } },
    adminPanel: { enabled: false },
    ...configOverride,
  };
  // Deep-merge webServer if both sides have it
  if (configOverride.webServer) {
    fullConfig.webServer = { ...configOverride.webServer, port };
  }

  const proc = spawn(process.execPath, [resolve(REPO_ROOT, 'dist/template/start.js')], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_CONFIG: JSON.stringify(fullConfig), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ready = false;
  let stderrBuf = '';
  let stdoutBuf = '';

  proc.stdout.on('data', (chunk) => {
    const s = chunk.toString();
    stdoutBuf += s;
    if (s.includes('started with') || s.includes('HTTP transport')) {
      ready = true;
    }
  });
  proc.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
  });

  async function waitReady(timeoutMs = 15000) {
    const start = Date.now();
    // eslint-disable-next-line no-unmodified-loop-condition -- set by stdout handler
    while (!ready) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `[${label}] server did not start within ${timeoutMs}ms.
stdout:
${stdoutBuf}
stderr:
${stderrBuf}`,
        );
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  function kill() {
    try {
      proc.kill('SIGINT');
    } catch {
      /* ignore */
    }
  }

  // Auto-cleanup at process exit
  process.on('exit', () => kill());
  process.on('uncaughtException', (err) => {
    console.error(err);
    kill();
    process.exit(1);
  });

  return {
    url: `http://127.0.0.1:${port}`,
    waitReady,
    kill,
    getStderr: () => stderrBuf,
  };
}
