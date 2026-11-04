#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative, sep } from 'path';
import { execFileSync } from 'node:child_process';

const templateDir = join(process.cwd(), './node_modules/fa-mcp-sdk/cli-template');
const cwd = process.cwd();

const targets = [
  { name: 'FA-MCP-SDK-DOC', src: join(templateDir, 'FA-MCP-SDK-DOC'), dest: join(cwd, 'FA-MCP-SDK-DOC') },
  {
    name: '.claude',
    src: join(templateDir, '.claude'),
    dest: join(cwd, '.claude'),
    preserve: ['settings.json', 'settings.local.json'],
    respectPin: true,
    exclude: ['skills'],
  },
  {
    name: '.agents/skills',
    src: join(templateDir, '.agents/skills'),
    dest: join(cwd, '.agents/skills'),
    respectPin: true,
    preserveUnknown: true,
  },
];

// Validate the installed template before migrating or replacing project files.
for (const { src } of targets) {
  if (!existsSync(src)) {
    throw new Error(`Source not found: ${src}`);
  }
}
const installedScripts = join(templateDir, '../scripts');
execFileSync(process.execPath, [join(installedScripts, 'claude-2-agents-symlink.js'), '--repo', cwd], {
  stdio: 'inherit',
});

// A folder containing a direct file named `pin` is preserved untouched —
// it is neither deleted nor overwritten with new content from the template.
function findPinnedFolders(rootDir) {
  const pinned = new Set();
  if (!existsSync(rootDir)) {
    return pinned;
  }
  const walk = (currentDir) => {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === 'pin')) {
      const rel = relative(rootDir, currentDir);
      pinned.add(rel);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(join(currentDir, entry.name));
      }
    }
  };
  walk(rootDir);
  return pinned;
}

function isInsidePinned(relPath, pinned) {
  if (!relPath) {
    return false;
  }
  if (pinned.has(relPath)) {
    return true;
  }
  for (const p of pinned) {
    if (relPath.startsWith(`${p}${sep}`)) {
      return true;
    }
  }
  return false;
}

function cleanExceptPinned(rootDir, pinned) {
  if (!existsSync(rootDir)) {
    return;
  }
  const walk = (currentDir) => {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(currentDir, entry.name);
      const fullRel = relative(rootDir, full);
      if (pinned.has(fullRel)) {
        continue;
      }
      const hasPinnedDescendant = [...pinned].some((p) => p.startsWith(`${fullRel}${sep}`));
      if (entry.isDirectory() && hasPinnedDescendant) {
        walk(full);
      } else {
        rmSync(full, { recursive: true, force: true });
      }
    }
  };
  walk(rootDir);
}

for (const { name, src, dest, preserve = [], respectPin = false, exclude = [], preserveUnknown = false } of targets) {
  if (!existsSync(src)) {
    console.error('Source not found:', src);
    process.exit(1);
  }
  const saved = {};
  for (const file of preserve) {
    const p = join(dest, file);
    if (existsSync(p)) {
      saved[file] = readFileSync(p);
    }
  }

  const pinned = respectPin ? findPinnedFolders(dest) : new Set();
  if (pinned.has('')) {
    console.log(`${name} preserved (pin)`);
    continue;
  }
  for (const entry of exclude) {
    pinned.add(entry);
  }
  if (name === '.agents/skills') {
    const deploy = 'deploy-mcp-to-remote-server';
    const cards = join(dest, deploy, 'configs');
    if (existsSync(cards)) {
      for (const entry of readdirSync(cards)) {
        if (entry !== '_example' && entry !== '.gitignore') {
          pinned.add(join(deploy, 'configs', entry));
        }
      }
    }
    // Keep legacy credentials available for explicit migration to a named installation.
    for (const file of ['remote-server-config.local.yaml', 'local.yaml', 'config.yml']) {
      const rel = join(deploy, 'config', file);
      if (existsSync(join(dest, rel))) {
        pinned.add(rel);
      }
    }
  }
  if (preserveUnknown && existsSync(dest)) {
    for (const entry of readdirSync(dest)) {
      if (!existsSync(join(src, entry))) {
        pinned.add(entry);
      }
    }
  }

  if (existsSync(dest)) {
    if (pinned.size > 0) {
      cleanExceptPinned(dest, pinned);
    } else {
      rmSync(dest, { recursive: true });
    }
  }

  cpSync(src, dest, {
    recursive: true,
    filter: (srcPath) => {
      if (preserve.includes(basename(srcPath))) {
        return false;
      }
      if (respectPin && pinned.size > 0) {
        const rel = relative(src, srcPath);
        if (isInsidePinned(rel, pinned)) {
          return false;
        }
      }
      return true;
    },
  });

  for (const [file, content] of Object.entries(saved)) {
    const p = join(dest, file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }

  if (pinned.size > 0) {
    console.log(`${name} updated (pinned folders preserved: ${[...pinned].join(', ')})`);
  } else {
    console.log(`${name} updated`);
  }
}

// Old projects ignored the entire canonical directory. Track skills and ignore generated links instead.
const gitignorePath = join(cwd, '.gitignore');
let gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
gitignore = gitignore.replace(/^\/?\.agents\/?[\t ]*\r?$/gm, '');
for (const pattern of ['/.claude/skills', '/.qwen/skills']) {
  if (!gitignore.split(/\r?\n/).includes(pattern)) {
    gitignore = `${gitignore.trimEnd()}\n${pattern}\n`;
  }
}
writeFileSync(gitignorePath, gitignore);

const scriptsSrcDir = join(cwd, './node_modules/fa-mcp-sdk/scripts');
const scriptsDestDir = join(cwd, 'scripts');
const individualScripts = [
  '+x.js',
  'cc-hook-oxlint-oxfmt-fix.cjs',
  'claude-2-agents-symlink.js',
  'clone-mcp-ext-apps.js',
  'fcp.js',
  'generate-jwt.js',
  'kill-port.js',
  'pre-commit',
  'remove-nul.js',
  'update-sdk.js',
];

for (const file of individualScripts) {
  const src = join(scriptsSrcDir, file);
  const dest = join(scriptsDestDir, file);
  if (!existsSync(src)) {
    console.error('Source not found:', src);
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
  console.log(`scripts/${file} updated`);
}
