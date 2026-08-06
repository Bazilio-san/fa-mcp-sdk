#!/usr/bin/env node
/**
 * End-to-end verification of the published fa-mcp-sdk package.
 *
 * Installs the CLI globally from the npm registry, regenerates a throw-away MCP server project from
 * `config.local.yaml`, and drives that project through the full developer loop: npm install, a clean
 * yarn install, lint, format check, clean build and a real server start with a /health probe.
 *
 * Every step writes its own log file and the run ends with a pass/fail table. Exit code 0 means the
 * whole scenario is clean; 1 means at least one step failed.
 *
 * Usage:
 *   node .claude/skills/verify-sdk/scripts/run-verification.js [options]
 *
 * Options:
 *   --from <step>        start at this step, skipping the earlier ones
 *   --only <a,b,c>       run just these steps
 *   --keep-running       leave the server running after the health probe succeeds
 *   --list               print the step names and exit
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(SKILL_DIR, '..', '..', '..');
const CONFIG_PATH = join(SKILL_DIR, 'config.local.yaml');

const C = {
  reset: '\u001b[0m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  grey: '\u001b[90m',
};

const argv = process.argv.slice(2);
const getOpt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const hasFlag = (name) => argv.includes(name);

/** Reads the flat `key: value` config written for the fa-mcp CLI. */
const readConfig = () => {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`${C.red}config.local.yaml not found at ${CONFIG_PATH}${C.reset}`);
    console.error('Copy config.example.yaml to config.local.yaml and adjust projectAbsPath / port.');
    process.exit(2);
  }
  const cfg = {};
  for (const line of readFileSync(CONFIG_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^([\w.\-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let value = m[2].trim();
    const quoted = /^"([^"]*)"|^'([^']*)'/.exec(value);
    if (quoted) {
      value = quoted[1] !== undefined ? quoted[1] : quoted[2];
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    cfg[m[1]] = value;
  }
  return cfg;
};

const config = readConfig();
const PROJECT_DIR = (config.projectAbsPath || '').replace(/\\/g, '/');
const PORT = config.port || '8888';

if (!PROJECT_DIR) {
  console.error(`${C.red}projectAbsPath is missing from config.local.yaml${C.reset}`);
  process.exit(2);
}
if (/[\\]/.test(config.projectAbsPath || '')) {
  console.error(`${C.red}projectAbsPath uses backslashes — YAML reads them as escape sequences.${C.reset}`);
  console.error('Write the path with forward slashes, for example "D:/DEV/SAND/mcp-test".');
  process.exit(2);
}

// The logs live next to the test project, never inside this repository: the SDK ignores (and the agent
// harness hides) _tmp/, which would make a failing log unreadable exactly when it is needed.
const LOG_DIR = join(dirname(PROJECT_DIR), 'verify-sdk-logs');
mkdirSync(LOG_DIR, { recursive: true });

/** Runs one shell command, tees the output into a log file and returns { code, out }. */
const sh = (command, { cwd = REPO_ROOT, logName, timeout = 20 * 60_000 } = {}) => {
  const res = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  if (logName) {
    writeFileSync(join(LOG_DIR, `${logName}.log`), `$ ${command}\n(cwd: ${cwd})\n\n${out}`, 'utf8');
  }
  return { code: res.status === null ? 1 : res.status, out };
};

const fail = (message, out) => ({ ok: false, message, tail: (out || '').split(/\r?\n/).slice(-25).join('\n') });
const pass = (message) => ({ ok: true, message });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls /health until the server answers. The probe asks for `Connection: close` so that no socket of ours
 * lingers on the port — a lingering socket makes the process that owns it (this runner) look like a process
 * "on the port" to netstat-based killers, which would then take the runner down together with the server.
 */
const probeHealth = async () => {
  const deadline = Date.now() + 90_000;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/health`, {
        signal: AbortSignal.timeout(5000),
        headers: { connection: 'close' },
      });
      const body = await response.text();
      if (response.status === 200 && /"status"\s*:\s*"healthy"/.test(body)) return { ok: true, body };
      lastError = `HTTP ${response.status}: ${body.slice(0, 200)}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(2000);
  }
  return { ok: false, error: lastError };
};

/** Frees the port before a start — safe here, because the runner holds no connection of its own yet. */
const freePortBeforeStart = () => {
  if (existsSync(join(PROJECT_DIR, 'scripts', 'kill-port.js'))) {
    sh(`node scripts/kill-port.js ${PORT}`, { cwd: PROJECT_DIR, logName: '08-free-port', timeout: 60_000 });
  }
};

/** Stops the server by its own process tree, so nothing else that merely talks to the port gets killed. */
const stopServer = (pid) => {
  if (!pid) return;
  if (process.platform === 'win32') {
    sh(`taskkill /F /T /PID ${pid}`, { logName: '09-stop-server', timeout: 60_000 });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
};

/** Runs git without a shell, so nothing has to be quoted for cmd.exe. */
const git = (args) => {
  const res = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return (res.stdout || '').trim();
};

/**
 * Lists the files that ship inside the npm package and changed after the given version was published.
 * A bare version bump in package.json does not count — only real content changes do.
 */
const unpublishedPayloadChanges = (publishedVersion) => {
  const commit = git(['log', '-1', '--format=%H', `-S"version": "${publishedVersion}"`, '--', 'package.json']);
  if (!commit) return [];
  const paths = ['src', 'bin', 'cli-template', 'config', 'scripts', 'package.json'];
  const changed = git(['diff', '--name-only', `${commit}..HEAD`, '--', ...paths])
    .split(/\r?\n/)
    .filter(Boolean);
  const withWorkingTree = new Set([
    ...changed,
    ...git(['status', '--porcelain', '--', ...paths])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3).trim()),
  ]);
  if (withWorkingTree.has('package.json')) {
    const diff = `${git(['diff', '-U0', `${commit}..HEAD`, '--', 'package.json'])}\n${git(['diff', '-U0', '--', 'package.json'])}`;
    const meaningful = diff
      .split(/\r?\n/)
      .filter((line) => /^[+-][^+-]/.test(line))
      .some((line) => !/^\s*[+-]\s*"version":/.test(line));
    if (!meaningful) withWorkingTree.delete('package.json');
  }
  return [...withWorkingTree];
};

const steps = [
  {
    name: 'global-install',
    title: 'Install the published CLI globally (npm install -g fa-mcp-sdk)',
    run: () => {
      const install = sh('npm install -g fa-mcp-sdk@latest', { logName: '01-global-install' });
      if (install.code !== 0) return fail('npm install -g failed', install.out);

      const installed = sh('npm ls -g fa-mcp-sdk --depth=0', { logName: '01-global-version' });
      const installedVersion = (/fa-mcp-sdk@([\d.]+)/.exec(installed.out) || [])[1] || 'unknown';
      const local = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

      const note = `installed ${installedVersion}, working copy ${local}`;
      if (installedVersion === local) return pass(note);

      // The pre-commit hook bumps the version on every commit, so "working copy ahead of the registry" is
      // the normal state and says nothing by itself. What matters is whether anything that ships inside the
      // package changed since the published version — that is what makes this run test stale code.
      const unpublished = unpublishedPayloadChanges(installedVersion);
      if (!unpublished.length) return pass(`${note} — nothing that ships in the package changed since then`);
      return {
        ...pass(note),
        warning: `The registry serves ${installedVersion}, but files that ship inside the package changed here since then (${unpublished.slice(0, 6).join(', ')}${unpublished.length > 6 ? `, +${unpublished.length - 6} more` : ''}). This run tests the OLD package — publish first, then re-run.`,
      };
    },
  },
  {
    name: 'clean-project',
    title: 'Remove the previous test project directory',
    run: () => {
      rmSync(PROJECT_DIR, { recursive: true, force: true });
      if (existsSync(PROJECT_DIR)) return fail(`could not remove ${PROJECT_DIR} (a process may still hold it)`);
      return pass(`${PROJECT_DIR} removed`);
    },
  },
  {
    name: 'generate',
    title: 'Generate the project (fa-mcp <config.local.yaml>) with no questions asked',
    run: () => {
      const gen = sh(`fa-mcp "${CONFIG_PATH}"`, { cwd: dirname(PROJECT_DIR), logName: '02-generate' });
      if (gen.code !== 0) return fail('the generator exited with a non-zero code', gen.out);
      if (/Could not load config file/i.test(gen.out)) {
        return fail('the generator could not read config.local.yaml and fell back to questions', gen.out);
      }
      if (!/created successfully/i.test(gen.out)) return fail('the success banner is missing from the output', gen.out);
      if (!existsSync(join(PROJECT_DIR, 'package.json'))) return fail('package.json is missing in the new project');
      return pass('project created from the config without prompts');
    },
  },
  {
    name: 'npm-install',
    title: 'Install dependencies with npm install',
    run: () => {
      const res = sh('npm install', { cwd: PROJECT_DIR, logName: '03-npm-install' });
      return res.code === 0 ? pass('npm install finished') : fail('npm install failed', res.out);
    },
  },
  {
    name: 'yarn-ci',
    title: 'Drop node_modules and reinstall with yarn ci',
    run: () => {
      rmSync(join(PROJECT_DIR, 'node_modules'), { recursive: true, force: true });
      if (existsSync(join(PROJECT_DIR, 'node_modules'))) return fail('node_modules could not be removed');
      const res = sh('yarn ci', { cwd: PROJECT_DIR, logName: '04-yarn-ci' });
      return res.code === 0 ? pass('yarn ci finished') : fail('yarn ci failed', res.out);
    },
  },
  {
    name: 'lint',
    title: 'Static analysis (yarn lint)',
    run: () => {
      const res = sh('yarn lint', { cwd: PROJECT_DIR, logName: '05-lint' });
      return res.code === 0 ? pass('oxlint reported nothing') : fail('oxlint reported problems', res.out);
    },
  },
  {
    name: 'format',
    title: 'Formatting check (yarn format)',
    run: () => {
      const res = sh('yarn format', { cwd: PROJECT_DIR, logName: '06-format' });
      return res.code === 0 ? pass('oxfmt reported nothing') : fail('oxfmt found unformatted files', res.out);
    },
  },
  {
    name: 'build',
    title: 'Clean build (yarn cb)',
    run: () => {
      const res = sh('yarn cb', { cwd: PROJECT_DIR, logName: '07-build' });
      return res.code === 0 ? pass('the build is clean') : fail('the build failed', res.out);
    },
  },
  {
    name: 'start',
    title: 'Start the server (yarn start) and probe /health',
    run: async () => {
      freePortBeforeStart();
      const logFile = join(LOG_DIR, '09-start.log');
      writeFileSync(logFile, '', 'utf8');
      const logFd = openSync(logFile, 'a');
      const child = spawn('yarn start', {
        cwd: PROJECT_DIR,
        shell: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', logFd, logFd],
      });
      child.unref();

      const health = await probeHealth();
      const startLog = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
      if (!health.ok) {
        stopServer(child.pid);
        return fail(`the server never answered on /health (${health.error})`, startLog);
      }
      if (hasFlag('--keep-running')) return pass(`/health answered, the server stays up on port ${PORT}`);

      stopServer(child.pid);
      await sleep(1500);
      const stillUp = await fetch(`http://127.0.0.1:${PORT}/health`, {
        signal: AbortSignal.timeout(3000),
        headers: { connection: 'close' },
      })
        .then(() => true)
        .catch(() => false);
      const note = stillUp ? ` (warning: something still listens on port ${PORT})` : '';
      return pass(`/health answered: ${health.body.slice(0, 120)}${note}`);
    },
  },
];

if (hasFlag('--list')) {
  for (const step of steps) console.log(`${step.name.padEnd(16)} ${step.title}`);
  process.exit(0);
}

const only = getOpt('--only');
const from = getOpt('--from');
let selected = steps;
if (only) {
  const wanted = only.split(',').map((s) => s.trim());
  selected = steps.filter((s) => wanted.includes(s.name));
} else if (from) {
  const index = steps.findIndex((s) => s.name === from);
  if (index < 0) {
    console.error(`${C.red}unknown step: ${from}${C.reset}`);
    process.exit(2);
  }
  selected = steps.slice(index);
}

console.log(`${C.cyan}fa-mcp-sdk end-to-end verification${C.reset}`);
console.log(`${C.grey}config:  ${CONFIG_PATH}${C.reset}`);
console.log(`${C.grey}project: ${PROJECT_DIR} (port ${PORT})${C.reset}`);
console.log(`${C.grey}logs:    ${LOG_DIR}${C.reset}\n`);

const results = [];
let failed = false;

for (const step of selected) {
  process.stdout.write(`${C.cyan}▶ ${step.name}${C.reset} — ${step.title}\n`);
  const startedAt = Date.now();
  let result;
  try {
    result = await step.run();
  } catch (error) {
    result = fail(`the step threw: ${error.message}`);
  }
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  result.seconds = seconds;
  result.name = step.name;
  results.push(result);

  if (result.ok) {
    console.log(`  ${C.green}OK${C.reset} (${seconds}s) — ${result.message}`);
    if (result.warning) console.log(`  ${C.yellow}WARNING${C.reset} — ${result.warning}`);
  } else {
    failed = true;
    console.log(`  ${C.red}FAILED${C.reset} (${seconds}s) — ${result.message}`);
    if (result.tail) console.log(`${C.grey}${result.tail}${C.reset}`);
    break;
  }
}

console.log(`\n${C.cyan}Summary${C.reset}`);
for (const r of results) {
  const mark = r.ok ? `${C.green}OK    ${C.reset}` : `${C.red}FAILED${C.reset}`;
  console.log(`  ${mark} ${r.name.padEnd(16)} ${r.seconds.padStart(6)}s  ${r.message}`);
}
const skipped = selected.slice(results.length);
for (const s of skipped) console.log(`  ${C.grey}SKIPPED ${s.name}${C.reset}`);

const warnings = results.filter((r) => r.warning);
if (warnings.length) {
  console.log(`\n${C.yellow}Warnings${C.reset}`);
  for (const w of warnings) console.log(`  ${w.name}: ${w.warning}`);
}

console.log(`\nFull logs: ${LOG_DIR}`);
process.exit(failed ? 1 : 0);
