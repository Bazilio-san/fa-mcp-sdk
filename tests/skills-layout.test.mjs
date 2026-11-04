import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import yaml from 'js-yaml';

const sdk = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const linker = path.join(sdk, 'scripts/claude-2-agents-symlink.js');
const fcp = path.join(sdk, 'scripts/fcp.js');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-skills-'));
  t.after(() => {
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'fa-skills-')));
    // The fixture owns all its files; links must be unlinked before recursive cleanup.
    for (const relative of ['.claude/skills', '.qwen/skills', '.agents/skills']) {
      const target = path.join(root, relative);
      if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) {
        execFileSync(process.execPath, [fcp, '--rm', target]);
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  const temporary = path.join(root, 'fixture-content.tmp');
  fs.writeFileSync(temporary, content);
  execFileSync(process.execPath, [fcp, target, temporary]);
  fs.rmSync(temporary);
}

function link(root, relative, target) {
  execFileSync(process.execPath, [fcp, '--link', path.join(root, relative), path.join(root, target)]);
}

function setup(root, ...args) {
  return spawnSync(process.execPath, [linker, '--repo', root, ...args], { encoding: 'utf8' });
}

function succeeds(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function verifyLayout(root) {
  assert.equal(fs.lstatSync(path.join(root, '.agents/skills')).isDirectory(), true);
  for (const name of ['.claude', '.qwen']) {
    const target = path.join(root, name, 'skills');
    assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(target), fs.realpathSync(path.join(root, '.agents/skills')));
  }
}

test('new layout, repeated setup, status, dry run and removal preserve canonical files', (t) => {
  const root = fixture(t);
  succeeds(setup(root, '--dry-run'));
  assert.deepEqual(fs.readdirSync(root), []);
  succeeds(setup(root));
  write(root, '.agents/skills/custom/SKILL.md', 'custom');
  succeeds(setup(root));
  succeeds(setup(root, 'status'));
  verifyLayout(root);
  succeeds(setup(root, 'remove'));
  assert.equal(fs.readFileSync(path.join(root, '.agents/skills/custom/SKILL.md'), 'utf8'), 'custom');
  assert.equal(fs.existsSync(path.join(root, '.claude/skills')), false);
  succeeds(setup(root));
  verifyLayout(root);
});

for (const reverseLink of [false, true]) {
  test(`migrate legacy skills, reverse link: ${reverseLink}`, (t) => {
    const root = fixture(t);
    const binary = Buffer.from([0, 255, 128, 10, 13]);
    write(root, '.claude/skills/custom/data.bin', binary);
    write(root, '.claude/skills/custom/config.local.yaml', 'private configuration');
    if (reverseLink) {
      link(root, '.agents/skills', '.claude/skills');
    }
    link(root, '.qwen/skills', '.claude/skills');
    succeeds(setup(root, '--dry-run'));
    assert.equal(fs.lstatSync(path.join(root, '.claude/skills')).isDirectory(), true);
    succeeds(setup(root));
    verifyLayout(root);
    assert.deepEqual(fs.readFileSync(path.join(root, '.agents/skills/custom/data.bin')), binary);
    assert.equal(
      fs.readFileSync(path.join(root, '.agents/skills/custom/config.local.yaml'), 'utf8'),
      'private configuration',
    );
  });
}

test('merge disjoint directories and identical files; conflicting files stop before mutations', (t) => {
  const root = fixture(t);
  write(root, '.claude/skills/shared/SKILL.md', 'legacy');
  write(root, '.claude/skills/old/SKILL.md', 'old');
  write(root, '.agents/skills/shared/SKILL.md', 'canonical');
  write(root, '.agents/skills/new/SKILL.md', 'new');
  assert.notEqual(setup(root, '--force').status, 0);
  assert.equal(fs.readFileSync(path.join(root, '.claude/skills/old/SKILL.md'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/old')), false);
  write(root, '.agents/skills/shared/SKILL.md', 'legacy');
  succeeds(setup(root));
  verifyLayout(root);
  assert.deepEqual(fs.readdirSync(path.join(root, '.agents/skills')).sort(), ['new', 'old', 'shared']);
});

test('foreign and dangling links require force; canonical links are never silently replaced', (t) => {
  const root = fixture(t);
  write(root, 'other/keep.txt', 'keep');
  link(root, '.claude/skills', 'other');
  assert.notEqual(setup(root).status, 0);
  succeeds(setup(root, '--force'));
  assert.equal(fs.readFileSync(path.join(root, 'other/keep.txt'), 'utf8'), 'keep');
  succeeds(setup(root, 'remove'));
  link(root, '.claude/skills', 'missing');
  assert.notEqual(setup(root).status, 0);
  succeeds(setup(root, '--force'));
  verifyLayout(root);
  const second = fixture(t);
  write(second, 'other/keep.txt', 'keep');
  link(second, '.agents/skills', 'other');
  assert.notEqual(setup(second, '--force').status, 0);
});

test('update migrates old projects, preserves pins, custom skills and settings, and is repeatable', (t) => {
  const root = fixture(t);
  const installed = path.join(root, 'node_modules/fa-mcp-sdk');
  fs.mkdirSync(installed, { recursive: true });
  fs.cpSync(path.join(sdk, 'scripts'), path.join(installed, 'scripts'), { recursive: true });
  write(installed, 'package.json', '{"type":"module"}');
  write(installed, 'cli-template/FA-MCP-SDK-DOC/new.md', 'new docs');
  write(installed, 'cli-template/.claude/settings.json', '{}');
  write(installed, 'cli-template/.claude/settings.local-example.json', '{}');
  write(installed, 'cli-template/.agents/skills/standard/SKILL.md', 'new skill');
  write(installed, 'cli-template/.agents/skills/pinned/SKILL.md', 'do not replace');
  write(installed, 'cli-template/.agents/skills/deploy-mcp-to-remote-server/SKILL.md', 'new deployment');
  write(installed, 'cli-template/.agents/skills/deploy-mcp-to-remote-server/configs/_example/rules.md', 'new example');
  write(root, '.claude/skills/standard/SKILL.md', 'old skill');
  write(root, '.claude/skills/standard/stale.txt', 'remove me');
  write(root, '.claude/skills/pinned/pin', '');
  write(root, '.claude/skills/pinned/SKILL.md', 'local skill');
  write(root, '.claude/skills/custom/SKILL.md', 'custom skill');
  write(root, '.claude/hooks/local/pin', '');
  write(root, '.claude/hooks/local/keep.js', 'local hook');
  write(root, '.claude/settings.json', '{"permissions":{"allow":["Read"]}}');
  write(root, '.claude/settings.local.json', '{"local":true}');
  write(root, '.agents/other.txt', 'unrelated');
  write(root, '.gitignore', '.agents/\nnode_modules/\n');
  link(root, '.agents/skills', '.claude/skills');
  link(root, '.qwen/skills', '.claude/skills');
  for (let i = 0; i < 2; i += 1) {
    const result = spawnSync(process.execPath, [path.join(installed, 'scripts/update-sdk.js')], {
      cwd: root,
      encoding: 'utf8',
    });
    succeeds(result);
    verifyLayout(root);
    const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
    assert.equal(read('.agents/skills/standard/SKILL.md'), 'new skill');
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/standard/stale.txt')), false);
    assert.equal(read('.agents/skills/pinned/SKILL.md'), 'local skill');
    assert.equal(read('.agents/skills/custom/SKILL.md'), 'custom skill');
    assert.equal(read('.claude/settings.json'), '{"permissions":{"allow":["Read"]}}');
    assert.equal(read('.claude/settings.local.json'), '{"local":true}');
    assert.equal(read('.claude/hooks/local/keep.js'), 'local hook');
    assert.equal(read('.agents/other.txt'), 'unrelated');
    assert.match(read('.gitignore'), /\/\.claude\/skills/);
    assert.doesNotMatch(read('.gitignore'), /^\.agents\/$/m);
    if (i === 0) {
      write(root, '.agents/skills/deploy-mcp-to-remote-server/configs/dev-1/local.yaml', 'private settings');
      write(root, '.agents/skills/deploy-mcp-to-remote-server/configs/dev-1/rules.md', 'private rules');
      write(root, '.agents/skills/deploy-mcp-to-remote-server/config/local.yaml', 'legacy settings');
    } else {
      assert.equal(read('.agents/skills/deploy-mcp-to-remote-server/configs/dev-1/local.yaml'), 'private settings');
      assert.equal(read('.agents/skills/deploy-mcp-to-remote-server/configs/dev-1/rules.md'), 'private rules');
      assert.equal(read('.agents/skills/deploy-mcp-to-remote-server/config/local.yaml'), 'legacy settings');
      assert.equal(read('.agents/skills/deploy-mcp-to-remote-server/configs/_example/rules.md'), 'new example');
      assert.equal(read('.agents/skills/deploy-mcp-to-remote-server/SKILL.md'), 'new deployment');
    }
  }
});

test('CLI generates canonical skills and project-local links, with a usable prepare command', (t) => {
  const root = fixture(t);
  const target = path.join(root, 'generated');
  const config = yaml.load(fs.readFileSync(path.join(sdk, '.agents/skills/verify-sdk/config.example.yaml'), 'utf8'));
  config.projectAbsPath = target.replaceAll('\\', '/');
  config['claude.isBypassPermissions'] = 'false';
  const configPath = path.join(root, 'generator.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  succeeds(
    spawnSync(process.execPath, [path.join(sdk, 'bin/fa-mcp.js'), configPath], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
    }),
  );
  verifyLayout(target);
  assert.ok(fs.existsSync(path.join(target, '.agents/skills/upgrade-sdk/SKILL.md')));
  const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.prepare, 'node ./scripts/claude-2-agents-symlink.js setup');
  succeeds(
    spawnSync(process.execPath, [path.join(target, 'scripts/claude-2-agents-symlink.js')], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
    }),
  );
});
