#!/usr/bin/env node

/**
 * Links Codex and Claude Code skills on any operating system.
 *
 * Layout:
 *
 *   .agents/skills/          canonical skill storage: real files (read directly by Codex)
 *   .claude/skills -> ../.agents/skills   (link used by Claude Code to access skills)
 *
 * The project root is determined by the script location (scripts/..), so the result is independent
 * of the working directory. Use --repo <path> to specify the root explicitly.
 *
 * Only compatible entities are linked. The following are not linked:
 *   - .claude/agents    — Codex agents are stored in .codex/agents/*.toml;
 *   - .claude/commands  — commands are migrated to skills;
 *   - .claude/settings  — Codex has its own .codex/config.toml and hooks.json;
 *   - .mcp.json         — Codex MCP servers are configured in .codex/config.toml.
 *
 * Usage: node scripts/claude-2-agents-symlink.js [setup|remove|status] [--dry-run] [--force]
 *                [--repo <path>]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FCP = path.join(DEFAULT_REPO_ROOT, 'scripts/fcp.js');

function mutate(args, dryRun) {
  if (dryRun) {
    log(`[dry run] fcp ${args.join(' ')}`);
  } else {
    execFileSync(process.execPath, [FCP, ...args], { stdio: 'pipe' });
  }
}

// Check the entire tree before migration: differing files require a manual merge.
function planMerge(source, destination, operations) {
  const target = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (!target) {
    operations.push(['--move', destination, source]);
    return;
  }
  const original = fs.lstatSync(source);
  if (original.isDirectory() && target.isDirectory()) {
    for (const name of fs.readdirSync(source)) {
      planMerge(path.join(source, name), path.join(destination, name), operations);
    }
  } else if (!(original.isFile() && target.isFile() && fs.readFileSync(source).equals(fs.readFileSync(destination)))) {
    throw new Error(`Skill migration conflict: ${source} and ${destination}. Merge them manually.`);
  }
  operations.push(['--rm', source]);
}

function migrateSkills(repoRoot, options) {
  const canonical = path.join(repoRoot, '.agents/skills');
  const legacy = path.join(repoRoot, '.claude/skills');
  const source = pathInfo(canonical);
  const old = pathInfo(legacy);
  const operations = [];
  if (source.isSymbolicLink) {
    if (!old.exists || old.isSymbolicLink || !sameResolvedPath(canonical, legacy)) {
      throw new Error(`Canonical directory ${canonical} is an unrelated link. Migration stopped.`);
    }
    operations.push(['--rm', canonical], ['--move', canonical, legacy]);
  } else if (old.exists && !old.isSymbolicLink) {
    if (!fs.lstatSync(legacy).isDirectory()) {
      throw new Error(`Expected a skills directory: ${legacy}`);
    }
    planMerge(legacy, canonical, operations);
  }
  for (const operation of operations) {
    mutate(operation, options.dryRun);
  }
  return operations.length > 0;
}

const LINK_MAPPINGS = [
  {
    name: 'skills',
    source: '.agents/skills',
    link: '.claude/skills',
  },
  {
    name: 'qwen',
    source: '.agents/skills',
    link: '.qwen/skills',
  },
];

function parseArgs(argv) {
  const result = {
    mode: 'setup',
    repo: DEFAULT_REPO_ROOT,
    dryRun: false,
    force: false,
  };

  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--remove') {
      result.mode = 'remove';
    } else if (arg === '--status') {
      result.mode = 'status';
    } else if (arg === '--repo') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('A path is required after --repo.');
      }
      result.repo = path.resolve(value);
      i += 1;
    } else if (arg.startsWith('--repo=')) {
      result.repo = path.resolve(arg.slice('--repo='.length));
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional[0]) {
    const mode = positional[0];
    if (!['setup', 'remove', 'status'].includes(mode)) {
      throw new Error(`Unknown mode: ${mode}. Expected setup, remove, or status.`);
    }
    result.mode = mode;
  }

  return result;
}

function log(message) {
  process.stdout.write(`${message}${os.EOL}`);
}

function warn(message) {
  process.stderr.write(`WARNING: ${message}${os.EOL}`);
}

function pathInfo(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    return {
      exists: true,
      isSymbolicLink: stat.isSymbolicLink(),
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, isSymbolicLink: false };
    }
    throw error;
  }
}

function realpathSafe(targetPath) {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return null;
  }
}

function normalizeForCompare(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameResolvedPath(a, b) {
  const realA = realpathSafe(a) || path.resolve(a);
  const realB = realpathSafe(b) || path.resolve(b);

  return normalizeForCompare(realA) === normalizeForCompare(realB);
}

function readLinkTargetAbsolute(linkPath) {
  const raw = fs.readlinkSync(linkPath);
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(path.dirname(linkPath), raw);
}

function currentTarget(linkPath) {
  try {
    return readLinkTargetAbsolute(linkPath);
  } catch {
    return 'unknown';
  }
}

function ensureDir(dirPath, dryRun) {
  if (pathInfo(dirPath).exists) {
    if (!fs.statSync(dirPath).isDirectory()) {
      throw new Error(`Expected a directory: ${dirPath}`);
    }
    return;
  }

  if (dryRun) {
    log(`[dry run] create directory ${dirPath}`);
    return;
  }

  fs.mkdirSync(dirPath, { recursive: true });
}

// On Windows, a directory junction is created; administrator privileges are not required.
function createDirectoryLink(sourcePath, linkPath, dryRun) {
  const parentDir = path.dirname(linkPath);
  ensureDir(parentDir, dryRun);

  const targetForLink =
    process.platform === 'win32' ? path.resolve(sourcePath) : path.relative(parentDir, sourcePath) || '.';

  if (dryRun) {
    log(`[dry run] link ${linkPath} -> ${targetForLink}`);
    return;
  }

  mutate(['--link', linkPath, sourcePath], false);
}

function setupMapping(repoRoot, mapping, options) {
  const sourcePath = path.resolve(repoRoot, mapping.source);
  const linkPath = path.resolve(repoRoot, mapping.link);

  ensureDir(sourcePath, options.dryRun);

  const link = pathInfo(linkPath);

  if (!link.exists) {
    createDirectoryLink(sourcePath, linkPath, options.dryRun);
    log(`Done: created link ${mapping.link} -> ${mapping.source}`);
    return;
  }

  if (link.isSymbolicLink) {
    if (sameResolvedPath(linkPath, sourcePath)) {
      if (normalizeForCompare(readLinkTargetAbsolute(linkPath)) !== normalizeForCompare(sourcePath)) {
        mutate(['--rm', linkPath], options.dryRun);
        createDirectoryLink(sourcePath, linkPath, options.dryRun);
      }
      log(`Done: ${mapping.link} already points to ${mapping.source}`);
      return;
    }

    if (!options.force) {
      throw new Error(
        `${mapping.link} is already a link but does not point to ${mapping.source}. Add --force to replace it. Current target: ${currentTarget(linkPath)}`,
      );
    }

    if (options.dryRun) {
      log(`[dry run] remove old link ${linkPath}`);
    } else {
      mutate(['--rm', linkPath], false);
    }

    createDirectoryLink(sourcePath, linkPath, options.dryRun);
    log(`Done: replaced link ${mapping.link}; it now points to ${mapping.source}`);
    return;
  }

  throw new Error(
    `${mapping.link} already exists and is not a link. Real files and directories are not overwritten: migrate them manually first.`,
  );
}

function removeMapping(repoRoot, mapping, options) {
  const sourcePath = path.resolve(repoRoot, mapping.source);
  const linkPath = path.resolve(repoRoot, mapping.link);

  const link = pathInfo(linkPath);

  if (!link.exists) {
    log(`Done: ${mapping.link} is absent`);
    return;
  }

  if (!link.isSymbolicLink) {
    warn(`${mapping.link} exists but is not a link. Skipping.`);
    return;
  }

  if (!sameResolvedPath(linkPath, sourcePath) && !options.force) {
    warn(
      `${mapping.link} is a link but does not point to ${mapping.source}. Add --force to remove it. Current target: ${currentTarget(linkPath)}`,
    );
    return;
  }

  if (options.dryRun) {
    log(`[dry run] remove link ${linkPath}`);
    return;
  }

  mutate(['--rm', linkPath], false);
  log(`Done: removed link ${mapping.link}`);
}

function statusMapping(repoRoot, mapping) {
  const sourcePath = path.resolve(repoRoot, mapping.source);
  const linkPath = path.resolve(repoRoot, mapping.link);

  const source = pathInfo(sourcePath);
  const link = pathInfo(linkPath);

  log(`\n[${mapping.name}]`);
  log(`source: ${mapping.source} ${source.exists ? 'exists' : 'absent'}`);
  log(`link:     ${mapping.link} ${link.exists ? 'exists' : 'absent'}`);

  if (link.exists && link.isSymbolicLink) {
    const ok = source.exists && sameResolvedPath(linkPath, sourcePath);
    log(`target:     ${currentTarget(linkPath)}`);
    log(`status: ${ok ? 'link is correct' : 'link points to the wrong target'}`);
    return;
  }

  if (link.exists && !link.isSymbolicLink) {
    log('status: a real directory or file occupies the link location');
    return;
  }

  log('status: link has not been created');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(options.repo);

  if (!pathInfo(repoRoot).exists) {
    throw new Error(`Project directory does not exist: ${repoRoot}`);
  }

  log(`project: ${repoRoot}`);
  log(`mode: ${options.mode}${options.dryRun ? ', dry run' : ''}${options.force ? ', with replacement' : ''}`);

  if (options.mode === 'setup' && migrateSkills(repoRoot, options) && options.dryRun) {
    log('[dry run] after migration, links .claude/skills and .qwen/skills -> .agents/skills will be created');
    return;
  }

  for (const mapping of LINK_MAPPINGS) {
    if (options.mode === 'setup') {
      setupMapping(repoRoot, mapping, options);
    } else if (options.mode === 'remove') {
      removeMapping(repoRoot, mapping, options);
    } else if (options.mode === 'status') {
      statusMapping(repoRoot, mapping);
    }
  }

  log('');
  log('Only skills are linked: they are the only entity understood in the same way by Codex and Claude Code.');
  log('Do not directly link .claude/agents, .claude/commands, settings, event hooks, or MCP server definitions.');
}

try {
  main();
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}${os.EOL}`);
  process.exit(1);
}
