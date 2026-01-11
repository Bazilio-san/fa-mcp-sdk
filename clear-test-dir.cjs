// Utility script to clear a target directory while preserving a whitelist of files/directories.
// Target: D:\\work\\PROJ\\SAND\\mcp-get-curr-rate
// Usage:
//   node clear-test-dir.js

const fs = require( 'fs' );
const path = require('path');

// Absolute path to the directory to clean
const TARGET_DIR = 'D:\\work\\PROJ\\SAND\\mcp-get-curr-rate';

// Names to preserve (files or directories at the root of TARGET_DIR)
const ALLOWED_FILES = [
  '.git',
  '.idea',
  '.vscode',
  '.swp',
  '.swo',
  '.DS_Store',
  '.sublime-project',
  '.sublime-workspace',
  'node_modules',
  'dist',
  '__misc',
  '_tmp',
  '~last-cli-config.json',
  'yarn.lock',
];

function isAllowed (name) {
  return ALLOWED_FILES.includes(name);
}

function assertSafeTarget (dir) {
  if (!path.isAbsolute(dir)) {
    throw new Error(`TARGET_DIR must be an absolute path: ${dir}`);
  }
  // Very basic guard to avoid cleaning an unintended location
  if (!dir.toLowerCase().includes('mcp-get-curr-rate')) {
    throw new Error('Safety check failed: TARGET_DIR does not include "mcp-get-curr-rate"');
  }
}

function removeEntry (entryPath) {
  try {
    fs.rmSync(entryPath, { recursive: true, force: true, maxRetries: 3 });
    console.log(`Removed: ${entryPath}`);
  } catch (err) {
    console.error(`Failed to remove ${entryPath}:`, err.message);
  }
}

function main () {
  assertSafeTarget(TARGET_DIR);

  if (!fs.existsSync(TARGET_DIR)) {
    console.error(`Target directory does not exist: ${TARGET_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(TARGET_DIR, { withFileTypes: true });
  let removed = 0;

  for (const dirent of entries) {
    const name = dirent.name;
    if (isAllowed(name)) {
      console.log(`Preserved: ${name}`);
      continue;
    }

    const full = path.join(TARGET_DIR, name);
    removeEntry(full);
    removed += 1;
  }

  console.log(`Done. Removed ${removed} entr${removed === 1 ? 'y' : 'ies'}.`);
}

if (require.main === module) {
  main();
}
