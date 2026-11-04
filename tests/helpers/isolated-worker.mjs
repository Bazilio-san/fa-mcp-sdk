import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

export async function isolatedWorker(mode = 'http', overrides = {}, environment = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-conformance-'));
  await copyFile(new URL('../../config/default.yaml', import.meta.url), join(dir, 'default.yaml'));
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'conformance-fixture', productName: 'Fixture', version: '1.0.0' }),
  );
  await writeFile(join(dir, 'README.md'), 'Synthetic conformance fixture');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((r) => reservation.close(r));
  const config = {
    webServer: {
      port,
      host: '127.0.0.1',
      auth: { enabled: false },
      originHosts: ['allowed.example', 'https://exact.example:444'],
    },
    consul: { service: { enable: false } },
    adminPanel: { enabled: false },
    agentTester: { enabled: false },
    isMainDBUsed: false,
    logger: { useFileLogger: false },
    mcp: {
      rateLimit: { maxRequests: 10000 },
      tasks: { enabled: true, pollIntervalMs: 10 },
      mrtr: { stateSecret: 'synthetic-state-key-0123456789abcdef' },
    },
    ...overrides,
  };
  config.webServer = { ...config.webServer, port, host: '127.0.0.1' };
  await writeFile(join(dir, 'test.json'), JSON.stringify(config));
  const env = Object.fromEntries(
    ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME']
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  const proc = spawn(process.execPath, [fileURLToPath(new URL('./conformance-worker.mjs', import.meta.url)), mode], {
    cwd: dir,
    env: { ...env, NODE_CONFIG_DIR: dir, NODE_ENV: 'test', ...environment },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  proc.stderr.on('data', (b) => {
    stderr = `${stderr}${b}`;
  });
  proc.stdout.on('data', (b) => {
    stdout = `${stdout}${b}`;
  });
  const url = `http://127.0.0.1:${port}`;
  const pending = new Map();
  let buffer = '';
  proc.stdout.on('data', (b) => {
    buffer = `${buffer}${b}`;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        const msg = JSON.parse(line);
        pending.get(msg.id)?.(msg);
      } catch {
        /* startup output */
      }
    }
  });
  const close = async () => {
    if (proc.exitCode === null) {
      proc.kill();
      await once(proc, 'exit');
    }
    if (!dir.startsWith(join(tmpdir(), 'mcp-conformance-'))) {
      throw new Error('Refusing to remove a directory outside the conformance temporary area');
    }
    await rm(dir, { recursive: true, force: true });
  };
  if (mode === 'http') {
    try {
      const deadline = Date.now() + 15000;
      for (;;) {
        try {
          if ((await fetch(`${url}/health`)).ok) {
            break;
          }
        } catch {
          /* starting */
        }
        if (Date.now() > deadline || proc.exitCode !== null) {
          throw new Error(`${stdout}\n${stderr}`);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch (e) {
      await close();
      throw e;
    }
  }
  return {
    url,
    close,
    proc,
    output: () => `${stdout}\n${stderr}`,
    stdio: (body) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(body.id);
          reject(new Error(`No reply for ${JSON.stringify(body)}: ${stderr}`));
        }, 10000);
        const responseId = typeof body.id === 'string' || typeof body.id === 'number' ? body.id : null;
        pending.set(responseId, (msg) => {
          clearTimeout(timer);
          pending.delete(body.id ?? null);
          resolve(msg);
        });
        proc.stdin.write(`${JSON.stringify(body)}\n`);
      }),
  };
}
