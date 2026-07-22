import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 39_881;
const config = {
  webServer: { host: '127.0.0.1', port, auth: { enabled: false } },
  consul: { service: { enable: false } },
  agentTester: { enabled: false },
  adminPanel: { enabled: false },
};
const child = spawn(process.execPath, [resolve(root, 'tests/fixtures/readiness-server.mjs')], {
  cwd: root,
  env: { ...process.env, NODE_CONFIG: JSON.stringify(config), NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));

const stop = () => {
  try {
    child.kill('SIGINT');
  } catch {
    // Already stopped.
  }
};
process.on('exit', stop);

try {
  const startedAt = Date.now();
  while (true) {
    if (child.exitCode !== null) {
      throw new Error(`Readiness fixture exited early (${child.exitCode}).\n${output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) {
        break;
      }
    } catch {
      // Server is still starting.
    }
    if (Date.now() - startedAt > 120_000) {
      throw new Error(`Readiness fixture did not start.\n${output}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }

  const concurrent = await Promise.all(Array.from({ length: 12 }, () => fetch(`http://127.0.0.1:${port}/ready`)));
  assert.ok(
    concurrent.every((response) => response.status === 200),
    'concurrent probes must share one check run',
  );

  const cached = await fetch(`http://127.0.0.1:${port}/ready`);
  assert.equal(cached.status, 200, 'the immediate probe must use the cached readiness snapshot');

  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_100));
  const refreshed = await fetch(`http://127.0.0.1:${port}/ready`);
  assert.equal(refreshed.status, 503, 'the dependency must be evaluated again after the cache TTL');
  assert.equal((await refreshed.json()).checks.slow_dependency, 'error');

  console.log('Readiness cache and single-flight tests passed.');
} finally {
  stop();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
}
