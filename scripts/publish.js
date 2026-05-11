#!/usr/bin/env node
/**
 * Publish package to npm.
 * Usage:
 *   node scripts/publish.js            # bumps patch version, stages tracked modifications, commits, pushes, publishes
 *   node scripts/publish.js --no-bump  # publishes current version as-is (no bump)
 *   node scripts/publish.js --add-all  # also stages untracked files (git add --all)
 *   node scripts/publish.js --help
 *
 * Default staging behavior: `git add -u` — modified tracked files go in (incl. the bumped package.json).
 * Untracked files are ignored unless --add-all is passed.
 */

import { spawnSync, execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';

const EXPECTED_BRANCH = 'master';

const c = {
  r: '\x1b[0;31m',
  g: '\x1b[0;32m',
  y: '\x1b[0;33m',
  m: '\x1b[0;35m',
  0: '\x1b[0m',
};

const args = process.argv.slice(2);
const noBump = args.includes('--no-bump') || args.includes('-n');
const addAll = args.includes('--add-all') || args.includes('-a');

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/publish.js [--no-bump|-n] [--add-all|-a]');
  console.log('  --no-bump, -n   Publish current version without bumping the patch number');
  console.log('  --add-all, -a   Also stage untracked files (git add --all).');
  console.log('                  By default only modified tracked files are staged (git add -u).');
  process.exit(0);
}

function pause(msg = 'Press Enter to continue ...') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(msg, () => {
    rl.close();
    resolve();
  }));
}

async function abort(msg) {
  console.error(`${c.r}${msg || '**** ERROR ****'}${c[0]}`);
  await pause();
  process.exit(0);
}

function run(cmd) {
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  return result.status ?? 1;
}

function bumpVersion() {
  const pkgPath = 'package.json';
  const pkgRaw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const oldVersion = pkg.version;
  console.log(`${c.m}**** Old version is ${c.g}${oldVersion}${c.m} ****${c[0]}`);

  const [major = 0, minor = 0, patch = 0] = oldVersion.split('.').map(Number);
  const newVersion = `${major}.${minor}.${patch + 1}`;

  console.log(
    `${c.m}**** Bumping version of ${c.g}${pkg.name}${c.m}: ${c.y}${oldVersion}${c.m} -> ${c.g}${newVersion}${c.m} ****${c[0]}`,
  );

  // Replace only the first occurrence (the package's own "version" field).
  writeFileSync(pkgPath, pkgRaw.replace(oldVersion, newVersion));

  // Update fa-mcp-sdk dependency in cli-template/package.json: "fa-mcp-sdk": "^X.Y.Z"
  const tplPath = 'cli-template/package.json';
  const tplRaw = readFileSync(tplPath, 'utf8');
  writeFileSync(tplPath, tplRaw.replace(/("fa-mcp-sdk":\s*")\^?[^"]+(")/, `$1^${newVersion}$2`));

  return newVersion;
}

async function main() {
  let branchName;
  try {
    branchName = execSync('git symbolic-ref --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    await abort(`${c.y}**** Version will not be bumped since retcode is not equals 0 ****${c[0]}`);
  }

  if (branchName !== EXPECTED_BRANCH) {
    console.log(
      `${c.y}**** git branch should be ${c.m}{${EXPECTED_BRANCH}}${c.y}, current: ${c.m}${branchName}${c.y} ****${c[0]}`,
    );
    await pause();
    process.exit(0);
  }

  if (run('npm run cb') !== 0) {
    await abort(`${c.y}**** Typescript build failed ****${c[0]}`);
  }

  let version;
  if (noBump) {
    version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    console.log(`${c.y}**** Skipping version bump, publishing current ${c.g}${version}${c.y} ****${c[0]}`);
  } else {
    version = bumpVersion();
  }

  // -u stages modifications/deletions to tracked files (incl. the bumped package.json files),
  // but does NOT include untracked files. --add-all switches to `git add --all` (also untracked).
  const stageCmd = addAll ? 'git add --all' : 'git add -u';
  if (run(stageCmd) !== 0) await abort();

  const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
  if (staged) {
    if (run(`git commit --no-verify -m "${version}"`) !== 0) await abort();
    if (run(`git push origin refs/heads/${EXPECTED_BRANCH}:${EXPECTED_BRANCH}`) !== 0) await abort();
  } else {
    console.log(`${c.y}**** Nothing staged, skipping git commit/push ****${c[0]}`);
  }

  run('npm publish');
  await pause();
}

main();
