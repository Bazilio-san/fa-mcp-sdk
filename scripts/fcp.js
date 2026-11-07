#!/usr/bin/env node

/**
 * The sanctioned write/delete channel for files under .claude/ (and any other path).
 *
 * Project instructions require this atomic channel for .claude/**, and direct shell modification of that tree
 * (rm, mv, cp, output redirection) is blocked by the harness. This script is the one allowed way to create,
 * overwrite or delete such files. See the /edit-claude-files skill for the full protocol.
 *
 * Usage:
 *   node scripts/fcp.js <filePath> <contentFilePath>   # create/overwrite <filePath> with the contents of the temp file
 *   node scripts/fcp.js --rm <path> [<path> ...]       # delete the given path(s) (files or directories, recursive)
 *   node scripts/fcp.js --move <destination> <source> # move without overwriting an existing destination
 *   node scripts/fcp.js --link <link> <directory>     # create a directory link (junction on Windows)
 *
 * <filePath>        — destination path (absolute or relative to project root)
 * <contentFilePath> — path to a temp file whose contents will be written to <filePath>
 *
 * Write mode reads the content from <contentFilePath> and writes it to <filePath>, creating parent directories if
 * needed. Delete mode (--rm / --delete) removes each target path; missing paths are reported, not an error.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);

if (argv[0] === '--move' || argv[0] === '--link') {
  if (argv.length !== 3) {
    console.error('Usage: node scripts/fcp.js --move|--link <destination> <source>');
    process.exit(1);
  }
  const destination = path.resolve(projectRoot, argv[1]);
  const source = path.resolve(projectRoot, argv[2]);
  // lstat also detects dangling links, which must never be overwritten implicitly.
  if (fs.lstatSync(destination, { throwIfNoEntry: false })) {
    throw new Error(`Destination already exists: ${destination}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (argv[0] === '--move') {
    fs.renameSync(source, destination);
  } else {
    const target = process.platform === 'win32' ? source : path.relative(path.dirname(destination), source);
    fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
  }
  console.log(`Saved: ${destination}`);
  process.exit(0);
}

// Delete mode: `--rm` / `--delete` followed by one or more paths to remove.
if (argv[0] === '--rm' || argv[0] === '--delete') {
  const targets = argv.slice(1);
  if (!targets.length) {
    console.error('Usage: node scripts/fcp.js --rm <path> [<path> ...]');
    process.exit(1);
  }
  for (const raw of targets) {
    const target = path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
    if (fs.lstatSync(target, { throwIfNoEntry: false })) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`Deleted: ${target}`);
    } else {
      console.log(`Already absent: ${target}`);
    }
  }
  process.exit(0);
}

const [rawTarget, rawSource] = argv;

if (!rawTarget || !rawSource) {
  console.error('Usage: node scripts/fcp.js <filePath> <contentFilePath>  |  node scripts/fcp.js --rm <path> [...]');
  process.exit(1);
}

const targetPath = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(projectRoot, rawTarget);
const sourcePath = path.isAbsolute(rawSource) ? rawSource : path.resolve(projectRoot, rawSource);

if (!fs.existsSync(sourcePath)) {
  console.error(`Source file not found: ${sourcePath}`);
  process.exit(1);
}

const content = fs.readFileSync(sourcePath);

const targetDir = path.dirname(targetPath);
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.writeFileSync(targetPath, content);
console.log(`Saved: ${targetPath} (${content.length} bytes)`);
