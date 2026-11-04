import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, symlink, realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = (args, cwd) =>
  JSON.parse(
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );

await test('packed archive excludes personal settings and generates a buildable project', async () => {
  const temp = await mkdtemp(join(root, '_tmp', 'package-hardening-'));
  // Retain this small reviewable artifact; never copy real local overrides or dependencies.
  const fixture = join(temp, 'fixture');
  await mkdir(fixture);
  const [{ files }] = npm(['pack', '--dry-run', '--json', '--ignore-scripts'], root);
  for (const { path } of files) {
    if (/^config\/(?:local[._-]|_local[-_])/i.test(path)) {
      continue;
    }
    const target = join(fixture, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, path), target);
  }
  const marker = 'SYNTHETIC-LOCAL-SETTINGS-MUST-NOT-SHIP';
  for (const name of ['local.yaml', 'local-2.yaml', 'local-production.json', 'local_test.yaml', '_local-secret.yaml']) {
    await writeFile(join(fixture, 'config', name), marker);
  }
  const [{ filename, files: packed }] = npm(['pack', '--json', '--ignore-scripts'], fixture);
  assert.ok(packed.some((f) => f.path === 'config/_local.yaml'));
  assert.ok(packed.some((f) => f.path === 'config/default.yaml'));
  assert.ok(!packed.some((f) => /^config\/(?:local[._-]|_local[-_])/i.test(f.path)));
  const unpack = join(temp, 'unpack');
  await mkdir(unpack);
  execFileSync('tar', ['-xzf', join(fixture, filename), '-C', unpack]);
  const archiveRoot = join(unpack, 'package');
  for (const f of packed.filter((entry) => entry.path.startsWith('config/'))) {
    assert.ok(!(await readFile(join(archiveRoot, f.path), 'utf8')).includes(marker));
  }
  const { MCPGenerator } = await import(pathToFileURL(join(archiveRoot, 'bin', 'fa-mcp.js')));
  const generator = new MCPGenerator();
  const config = Object.fromEntries(
    [...generator.requiredParams, ...generator.optionalParams].map((p) => [p.name, p.defaultValue ?? '']),
  );
  Object.assign(config, {
    projectAbsPath: join(temp, 'generated'),
    'project.name': 'synthetic-generated',
    'project.description': 'Synthetic package check',
    'project.productName': 'Synthetic',
    NODE_ENV: 'test',
    PM2_NAMESPACE: 'test',
    SERVICE_INSTANCE: 'test',
  });
  await generator.createProject(config);
  for (const name of ['default.yaml', '_local.yaml', 'local.yaml']) {
    const content = await readFile(join(config.projectAbsPath, 'config', name), 'utf8');
    assert.ok(!content.includes(marker));
    assert.ok(!content.includes('{{'));
    assert.ok(yaml.load(content));
  }
  await mkdir(join(config.projectAbsPath, 'node_modules'), { recursive: true });
  await symlink(
    await realpath(archiveRoot),
    join(config.projectAbsPath, 'node_modules', 'fa-mcp-sdk'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], {
    cwd: config.projectAbsPath,
    stdio: 'pipe',
    timeout: 60000,
  });
  console.log(`Verified archive and generated project: ${temp}`);
});
