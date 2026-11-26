import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { fetchWithRetry, writeCheckStatus } from '../../deploy/update-state.cjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const connectionError = () =>
  Object.assign(new Error('git fetch failed'), {
    stderr: 'kex_exchange_identification: Connection closed by remote host',
  });

test('temporary failures get three retries with increasing delays', async () => {
  const delays = [];
  const retries = [];
  let calls = 0;
  const result = await fetchWithRetry(
    () => {
      if (++calls <= 3) {
        throw connectionError();
      }
      return 'ok';
    },
    { sleep: async (ms) => delays.push(ms), onRetry: (attempt) => retries.push(attempt) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 4);
  assert.deepEqual(delays, [2000, 4000, 8000]);
  assert.deepEqual(retries, [1, 2, 3]);
});

test('exhausted retries preserve the original error', async () => {
  const error = connectionError();
  let calls = 0;
  await assert.rejects(
    fetchWithRetry(
      () => {
        calls++;
        throw error;
      },
      { sleep: async () => {} },
    ),
    (actual) => actual === error,
  );
  assert.equal(calls, 4);
});

for (const message of [
  'Permission denied (publickey).',
  'Authentication failed',
  'Host key verification failed',
  "fatal: couldn't find remote ref master",
  'Repository not found',
  'Permission denied; Connection closed by remote host',
  'unknown failure',
]) {
  test(`permanent or unknown failure is not retried: ${message}`, async () => {
    let calls = 0;
    await assert.rejects(
      fetchWithRetry(
        () => {
          calls++;
          throw Object.assign(new Error('git fetch failed'), { stderr: message });
        },
        { sleep: async () => assert.fail('Unexpected retry') },
      ),
    );
    assert.equal(calls, 1);
  });
}

test('a successful fetch needs no delay', async () => {
  assert.equal(
    await fetchWithRetry(() => 'ok', {
      sleep: async () => assert.fail('Unexpected retry'),
    }),
    'ok',
  );
});

test('check status replaces stale results atomically and stays on one line', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-update-status-'));
  try {
    const file = path.join(temporary, 'check.log');
    writeCheckStatus(file, 'FAIL', 'old error');
    writeCheckStatus(file, 'SUCCESS', 'No changes\r\ndetected');
    assert.match(fs.readFileSync(file, 'utf8'), /^SUCCESS \| .*Z \| No changes detected\n$/);
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

// Run the real entry point in an isolated checkout. All operating-system commands
// are intercepted; the test cannot fetch code, send notifications or restart services.
function runFixture(scenario) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-update-entry-'));
  const project = path.join(temporary, 'app');
  fs.mkdirSync(path.join(project, 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(project, 'node_modules', 'yaml'), { recursive: true });
  fs.mkdirSync(path.join(project, 'dist'));
  fs.mkdirSync(path.join(project, '.git'));
  fs.mkdirSync(path.join(project, 'config'));
  fs.writeFileSync(path.join(project, 'config/local.yaml'), '{"webServer":{"port":9064}}');
  if (scenario === 'npm-updated') {
    fs.writeFileSync(path.join(project, 'package-lock.json'), '{}');
  }
  fs.copyFileSync(path.join(root, 'update.js'), path.join(project, 'update.js'));
  fs.copyFileSync(path.join(root, 'deploy/update-state.cjs'), path.join(project, 'deploy/update-state.cjs'));
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', type: 'module' }));
  fs.writeFileSync(path.join(project, 'node_modules/yaml/package.json'), '{"main":"index.cjs"}');
  fs.writeFileSync(path.join(project, 'node_modules/yaml/index.cjs'), 'module.exports = { parse: JSON.parse };');
  const deploymentStatus = path.join(temporary, 'deploy__app__status.log');
  fs.writeFileSync(deploymentStatus, 'FAIL | previous deployment\n');
  fs.writeFileSync(path.join(temporary, 'deploy__app__check_status.log'), 'FAIL | previous check\n');
  const preload = path.join(temporary, 'mock.cjs');
  fs.writeFileSync(
    preload,
    `
const fs = require('node:fs');
const cp = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
let attempts = 0;
const scenario = process.env.UPDATE_TEST_SCENARIO;
const npmUpdate = ['npm-updated', 'migrate-to-npm'].includes(scenario);
const changed = npmUpdate || ['updated', 'build-failure'].includes(scenario);
global.setTimeout = (fn) => { queueMicrotask(fn); return 0; };
global.fetch = async () => ({ status: 200, body: { cancel: async () => {} } });
cp.spawnSync = () => { throw new Error('Unexpected child process'); };
cp.spawn = () => { throw new Error('Unexpected notification'); };
cp.execSync = (command) => {
  fs.appendFileSync('commands.log', \`\${JSON.stringify(command)}\\n\`);
  if (command.startsWith('git fetch ')) {
    attempts++;
    if (scenario === 'permanent') throw Object.assign(new Error('git fetch failed'), { stderr: 'Permission denied (publickey)' });
    if (scenario === 'exhausted' || (scenario === 'recovered' && attempts < 3)) {
      throw Object.assign(new Error('git fetch failed'), { stderr: 'kex_exchange_identification: Connection closed by remote host' });
    }
    return '';
  }
  if (command === 'git rev-parse HEAD') return 'aaaa\\n';
  if (command === 'git rev-parse origin/master') return changed ? 'bbbb\\n' : 'aaaa\\n';
  if (command === 'git diff --name-only HEAD origin/master') {
    if (scenario === 'migrate-to-npm') return 'package-lock.json\\n';
    if (npmUpdate) return 'package.json\\n';
    return changed ? 'src/start.ts\\n' : '';
  }
  if (command.startsWith('git diff ')) return '';
  if (command === 'git branch --show-current') return 'master\\n';
  if (command.startsWith('git reset ') && scenario === 'migrate-to-npm') {
    fs.writeFileSync('package-lock.json', '{}');
  }
  if (/^(git checkout |git reset |git clean |journalctl |rm -rf )/.test(command)) return '';
  if (command === 'npm ci --no-audit --no-fund') return '';
  if (command.includes('cb')) {
    if (scenario === 'build-failure') throw new Error('Build failed');
    return '';
  }
  if (command.startsWith('systemctl show ')) return 'loaded';
  if (/^systemctl (restart |is-active )/.test(command)) return '';
  throw new Error(\`Unexpected command: \${command}\`);
};
syncBuiltinESMExports();
`,
  );
  try {
    const result = spawnSync(process.execPath, ['--require', preload, path.join(project, 'update.js')], {
      encoding: 'utf8',
      env: { ...process.env, MCP_UPDATE_LOCKED: '1', UPDATE_TEST_SCENARIO: scenario },
      timeout: 10000,
    });
    assert.ifError(result.error);
    return {
      exitCode: result.status,
      output: `${result.stdout}\n${result.stderr}`,
      check: fs.readFileSync(path.join(temporary, 'deploy__app__check_status.log'), 'utf8'),
      deployment: fs.readFileSync(deploymentStatus, 'utf8'),
      commands: fs.readFileSync(path.join(project, 'commands.log'), 'utf8').trim().split('\n').map(JSON.parse),
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

for (const scenario of [
  'unchanged',
  'recovered',
  'permanent',
  'exhausted',
  'build-failure',
  'updated',
  'npm-updated',
  'migrate-to-npm',
]) {
  test(`entry point: ${scenario}`, () => {
    const result = runFixture(scenario);
    const failedCheck = ['permanent', 'exhausted'].includes(scenario);
    const npmUpdate = ['npm-updated', 'migrate-to-npm'].includes(scenario);
    assert.equal(result.exitCode, failedCheck || scenario === 'build-failure' ? 1 : 0, result.output);
    assert.match(result.check, failedCheck ? /^FAIL \|/ : /^SUCCESS \|/);
    assert.equal(
      result.commands.filter((command) => command.startsWith('git fetch ')).length,
      scenario === 'recovered' ? 3 : scenario === 'exhausted' ? 4 : 1,
    );
    if (scenario === 'build-failure') {
      assert.match(result.check, /Update required/);
      assert.match(result.deployment, /FAIL .*Build failed/);
    } else if (scenario === 'updated' || npmUpdate) {
      assert.match(result.check, /Update required/);
      assert.match(result.deployment, /^SUCCESS \|/);
    } else {
      assert.equal(result.deployment, 'FAIL | previous deployment\n');
      assert.equal(
        result.commands.some((command) => /git (checkout|reset|clean)|restart|install/.test(command)),
        false,
      );
    }
    if (npmUpdate) {
      const clean = result.commands.indexOf('git clean -fd');
      const install = result.commands.indexOf('npm ci --no-audit --no-fund');
      assert.ok(clean >= 0 && install > clean);
      assert.ok(result.commands.indexOf('npm run cb') > install);
      assert.equal(result.commands.some((command) => command.startsWith('yarn ')), false);
    } else if (scenario === 'updated') {
      assert.ok(result.commands.includes('yarn cb'));
    }
    if (!failedCheck && !npmUpdate && !['build-failure', 'updated'].includes(scenario)) {
      assert.match(result.check, /No changes detected/);
    }
  });
}

const bash =
  process.platform === 'win32'
    ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe')
    : '/bin/bash';
const remoteSource = fs.readFileSync(path.join(root, '.agents/skills/deploy/scripts/remote.cjs'), 'utf8');
const commandSource = remoteSource.slice(
  remoteSource.indexOf('function cmdUpdate(cfg) {'),
  remoteSource.indexOf('// Push selected installation files'),
);

for (const mode of ['systemd', 'docker']) {
  for (const outcome of ['success', 'build-failure', 'fetch-failure', 'modern']) {
    test(`cron migration: ${mode}, ${outcome}`, { skip: !fs.existsSync(bash) }, () => {
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-update-cron-'));
      try {
        const project = temporary.replaceAll('\\', '/');
        const cron = path.join(temporary, 'cron').replaceAll('\\', '/');
        const original = `* * * * * root node ${project}/update.cjs\n`;
        const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
        const node = quote(process.execPath.replaceAll('\\', '/'));
        const nvmLog = path.join(temporary, 'nvm-version');
        if (mode === 'systemd') {
          fs.mkdirSync(path.join(temporary, '.nvm'));
          fs.writeFileSync(
            path.join(temporary, '.nvm/nvm.sh'),
            `nvm() { printf '%s\\n' "$*" > "$HOME/nvm-version"; }
node() { ${node} "$@"; }
`,
          );
        }
        fs.writeFileSync(cron, original);
        const updater =
          outcome === 'fetch-failure'
            ? 'process.exit(7);'
            : `require('node:fs').writeFileSync('update.js', ''); process.exit(${outcome === 'build-failure' ? 7 : 0});`;
        fs.writeFileSync(path.join(temporary, 'update.cjs'), updater);
        if (outcome === 'modern') {
          fs.writeFileSync(path.join(temporary, 'update.js'), 'process.exit(0);');
          fs.writeFileSync(path.join(temporary, 'update.cjs'), 'process.exit(99);');
        }
        let script;
        runInNewContext(`${commandSource}\ncmdUpdate(cfg);`, {
          cfg: { deploymentMode: mode, projectPath: project, name: 'test', nodeVersion: '22.17.1' },
          NODE_BIN: node,
          CONTAINER: 'test',
          sanitizeName: (name) => name,
          say: () => {},
          sq: (value) => {
            if (value.startsWith('/etc/cron.d/')) {
              return quote(cron);
            }
            if (value.includes('set -euo pipefail')) {
              script = value;
            }
            return quote(value);
          },
          sshRun: (_cfg, command) => {
            if (mode === 'systemd') {
              script = command;
            }
          },
        });
        const result = spawnSync(bash, ['--noprofile', '--norc', '-c', script], {
          encoding: 'utf8',
          env: { ...process.env, HOME: project },
          timeout: 10000,
        });
        assert.ifError(result.error);
        assert.equal(
          result.status,
          ['build-failure', 'fetch-failure'].includes(outcome) ? 7 : 0,
          `${result.stdout}\n${result.stderr}`,
        );
        if (mode === 'systemd') {
          assert.equal(fs.readFileSync(nvmLog, 'utf8').trim(), 'use 22.17.1');
        }
        assert.equal(
          fs.readFileSync(cron, 'utf8'),
          outcome === 'fetch-failure' ? original : original.replace('/update.cjs', '/update.js'),
        );
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    });
  }
}
