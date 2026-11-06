import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const state = require('../cli-template/deploy/update-state.cjs');
const remoteSource = fs.readFileSync(
  'cli-template/.agents/skills/deploy-mcp-to-remote-server/scripts/remote.cjs',
  'utf8',
);

test('dependency, build and documentation inputs', () => {
  assert.deepEqual(state.classifyChanges(['README.md']), { dependencies: false, build: false });
  for (const file of ['yarn.lock', 'package.json', 'patches/fix.patch']) {
    assert.deepEqual(state.classifyChanges([file]), { dependencies: true, build: true });
  }
  for (const file of ['tsconfig.json', 'scripts/copy-assets.js', 'src/server.ts', 'assets/icon.png']) {
    assert.equal(state.classifyChanges([file]).build, true);
  }
});

test('pending state survives a new reader and damaged state requests full retry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-update-'));
  try {
    const file = path.join(dir, '.git', 'pending.json');
    assert.equal(state.readPending(file), null);
    state.writePending(file, { dependencies: true, build: true });
    assert.deepEqual(state.readPending(file), { dependencies: true, build: true });
    fs.writeFileSync(file, '{');
    assert.deepEqual(state.readPending(file), { dependencies: true, build: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('readiness retries and rejects a service that remains unavailable', async () => {
  let attempts = 0;
  await state.waitForHealth('http://localhost/health', {
    attempts: 3,
    delay: 0,
    fetcher: async () => ({ status: ++attempts === 3 ? 204 : 503 }),
  });
  assert.equal(attempts, 3);
  await assert.rejects(
    state.waitForHealth('http://localhost/health', {
      attempts: 2,
      delay: 0,
      fetcher: async () => ({ status: 302 }),
    }),
    /health check failed/,
  );
});

test('failed build after Git reset is retried with identical HEAD; success requires health', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-retry-'));
  const pendingFile = path.join(dir, 'pending.json');
  const source = fs.readFileSync('cli-template/update.cjs', 'utf8');
  const main = source.slice(source.indexOf('async function main()'), source.indexOf('// Handle process termination'));
  let head = 'old';
  let builds = 0;
  let healthFails = false;
  const verdicts = [];
  const processMock = { exitCode: 0 };
  const context = vm.createContext({
    ...state,
    pendingFile,
    process: processMock,
    nodeVersion: null,
    DEFAULT_NODE_VERSION: '22',
    runTimeLogFile: path.join(dir, 'run.log'),
    lastDeployLogFile: path.join(dir, 'last.log'),
    CWD: dir,
    path,
    logBuffer: '',
    fs: { ...fs, existsSync: (file) => ['node_modules', 'dist'].includes(file) || fs.existsSync(file) },
    logTryUpdate() {},
    logIt() {},
    logError() {},
    nowPretty: () => '',
    colorG: { y: (s) => s },
    parseArgs: () => ({}),
    getServiceName: () => ({ serviceName: 'app', serviceNamePM: 'app--prod' }),
    loadConfig: () => ({ branch: 'main', healthUrl: 'http://localhost/health' }),
    execCommand: (command) => {
      if (command === 'git rev-parse HEAD') {
        return head;
      }
      if (command.startsWith('git rev-parse origin/')) {
        return 'new';
      }
      if (command === 'git branch --show-current') {
        return 'main';
      }
      if (command.startsWith('git diff --name-only HEAD')) {
        return head === 'old' ? 'src/app.ts' : '';
      }
      if (command.startsWith('git reset --hard')) {
        head = 'new';
      }
      return '';
    },
    reinstallDependencies() {},
    buildQuasar() {},
    restartService() {},
    systemctlServiceExists: () => true,
    compile: () => {
      if (++builds === 1) {
        throw new Error('Build failed');
      }
    },
    waitForHealth: async () => {
      if (healthFails) {
        throw new Error('Health failed');
      }
    },
    writeStatus: (status) => verdicts.push(status),
    sendNotifications: async () => {},
  });
  try {
    vm.runInContext(main, context);
    await vm.runInContext('main()', context);
    assert.equal(head, 'new');
    assert.equal(processMock.exitCode, 1);
    assert.equal(state.readPending(pendingFile).build, true);
    healthFails = true;
    await vm.runInContext('main()', context);
    assert.equal(builds, 2);
    assert.equal(fs.existsSync(pendingFile), true);
    healthFails = false;
    processMock.exitCode = 0;
    await vm.runInContext('main()', context);
    assert.equal(builds, 3);
    assert.equal(fs.existsSync(pendingFile), false);
    assert.deepEqual(verdicts, ['FAIL', 'FAIL', 'SUCCESS']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('named targets, argument separation, private delivery and failure propagation without SSH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-remote-'));
  const skill = path.join(dir, '.agents', 'skills', 'deploy');
  const calls = [];
  const output = [];
  const processMock = {
    argv: [],
    exitCode: 0,
    exit: (code) => {
      throw new Error(`exit ${code}`);
    },
  };
  let status = 0;
  try {
    fs.mkdirSync(path.join(skill, 'docker'), { recursive: true });
    fs.writeFileSync(path.join(skill, 'docker', 'Dockerfile'), 'FROM ubuntu:22.04');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"example"}');
    const key = path.join(dir, 'key');
    fs.writeFileSync(key, 'PRIVATE_KEY_TEST');
    for (const alias of ['dev-1', 'prod-2']) {
      const folder = path.join(skill, 'configs', alias);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'rules.md'), 'Rules');
      fs.writeFileSync(
        path.join(folder, 'config.yaml'),
        `server:\n  host: ${alias}.example.com\n  user: root\n  keyPath: ${key}\ndeployment:\n  mode: ${alias === 'prod-2' ? 'docker' : 'systemd'}\ngit:\n  repoUrl: git@example.com:repo\n  deployKeyPath: ${key}\nmcp:\n  dns: ${alias}.example.com\nproject:\n  branch: main\nupdate:\n  healthUrl: http://localhost:9876/health\n  telegram:\n    botToken: "SECRET # token"\n    chatId: "00123"\n  smtp:\n    pass: "SMTP # secret"\n`,
      );
      fs.writeFileSync(path.join(folder, 'local.yaml'), 'webServer:\n  port: 9876\nsecret: SECRET_TEST\n');
    }
    const context = vm.createContext({
      require: (name) =>
        name === 'child_process'
          ? {
              spawnSync: (...args) => {
                calls.push(args);
                return { status };
              },
            }
          : require(name),
      module: { exports: {} },
      __dirname: path.join(skill, 'scripts'),
      console: { log: (...args) => output.push(args.join(' ')), error: () => {} },
      process: processMock,
      Buffer,
    });
    vm.runInContext(remoteSource, context);
    const run = (args) => {
      processMock.argv = ['node', 'remote.cjs', ...args];
      vm.runInContext('main()', context);
    };
    assert.throws(() => run(['status']), /exit 1/);
    assert.throws(() => run(['--server', '../dev-1', 'status']), /exit 1/);
    assert.throws(() => run(['--server', '_example', 'status']), /exit 1/);
    assert.throws(() => run(['--server', 'missing', 'status']), /exit 1/);
    run(['--server', 'dev-1', 'show']);
    run(['show', '--server', 'prod-2']);
    assert.equal(calls.length, 0);
    assert.match(output.join('\n'), /example-dev-1/);
    assert.match(output.join('\n'), /example-prod-2/);
    assert.doesNotMatch(output.join('\n'), /SECRET_TEST|PRIVATE_KEY_TEST/);
    const selected = context.module.exports.selectServer(['--server', 'dev-1', 'exec', '--', '--server', 'child']);
    assert.deepEqual(Array.from(selected.rest), ['exec', '--', '--server', 'child']);
    run(['--server', 'dev-1', 'show']);
    const deployment = vm.runInContext('loadConfig("dev-1")', context);
    assert.equal(deployment.deploymentMode, 'systemd');
    assert.equal(deployment.statePath, '/opt/node/example-dev-1/data-cache');
    const generated = require('yaml').parse(deployment.deployConfigYaml);
    assert.equal(generated.branch, 'main');
    assert.equal(generated.healthUrl, 'http://localhost:9876/health');
    assert.equal(generated.telegram.botToken, 'SECRET # token');
    assert.equal(generated.telegram.chatId, '00123');
    assert.equal(generated.smtp.pass, 'SMTP # secret');
    assert.equal(generated.server, undefined);
    assert.equal(generated.git, undefined);
    const legacyFile = path.join(skill, 'configs', 'dev-1', 'config.yml');
    fs.writeFileSync(legacyFile, 'branch: old');
    assert.throws(() => run(['--server', 'dev-1', 'show']), /exit 1/);
    fs.unlinkSync(legacyFile);
    run(['--server', 'dev-1', 'deploy']);
    const script = calls.at(-1)[2].input;
    assert.match(script, /node deploy\/srv\.cjs install/);
    assert.match(script, /systemctl restart example-dev-1--prod/);
    assert.match(script, /command -v restart/);
    assert.match(script, /restart add "\$CANDIDATE" example-dev-1--prod/);
    assert.match(script, /git clean -fd -e '\/data-cache\/'/);
    assert.doesNotMatch(script, /docker create|docker cp/);
    assert.doesNotMatch(script, /-e (GIT_SSH_KEY|CONFIG_LOCAL|DEPLOY_CONFIG)/);
    run(['--server', 'dev-1', 'uninstall', '--yes']);
    const uninstallScript = calls.at(-1)[2].input;
    assert.match(uninstallScript, /restart del "\$ALIAS"/);
    assert.match(uninstallScript, /systemctl disable --now example-dev-1--prod/);
    assert.match(uninstallScript, /rm -rf -- "\$PROJECT_PATH"/);
    assert.match(uninstallScript, /Removed systemd state with project path: \$STATE_PATH/);
    assert.doesNotMatch(uninstallScript, /docker rm|docker rmi/);
    run(['--server', 'prod-2', 'deploy']);
    const dockerScript = calls.findLast((call) => call[2]?.input?.includes('docker create'))[2].input;
    assert.match(dockerScript, /docker create/);
    assert.match(dockerScript, /docker cp/);
    assert.match(dockerScript, /-v '\/opt\/node\/example-prod-2':\/opt\/node\/example-prod-2/);
    run(['--server', 'prod-2', 'uninstall', '--yes']);
    const dockerUninstallScript = calls.at(-1)[2].input;
    assert.match(dockerUninstallScript, /docker rm -f example-prod-2/);
    assert.match(dockerUninstallScript, /docker rmi -f "\$IMAGE_ID"/);
    assert.match(dockerUninstallScript, /Preserved state path: \$STATE_PATH/);
    assert.doesNotMatch(dockerUninstallScript, /rm -rf -- "\$STATE_PATH"/);
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
    if (fs.existsSync(bash)) {
      run(['--server', 'dev-1', 'push-config']);
      for (const call of calls) {
        if (call[1].at(-1) === 'bash -l') {
          const syntax = spawnSync(bash, ['-n'], { input: call[2].input, encoding: 'utf8' });
          assert.equal(syntax.status, 0, syntax.stderr);
        }
      }
    }
    assert.doesNotMatch(calls.map((call) => call[1].join(' ')).join('\n'), /PRIVATE_KEY_TEST|SECRET_TEST/);
    status = 7;
    run(['--server', 'dev-1', 'update']);
    assert.equal(processMock.exitCode, 7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
