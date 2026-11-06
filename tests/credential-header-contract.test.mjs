import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const coreRoot = path.resolve('src/core');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(fullPath) : fullPath;
    }),
  );
  return nested.flat().filter((file) => /\.(?:ts|js)$/.test(file));
}

const forbiddenNames = ['x-username', 'x-password'];
const files = await sourceFiles(coreRoot);
const matches = [];

for (const file of files) {
  const source = (await readFile(file, 'utf8')).toLowerCase();
  for (const name of forbiddenNames) {
    if (source.includes(name)) {
      matches.push(`${path.relative(coreRoot, file)}: ${name}`);
    }
  }
}

assert.deepEqual(matches, [], 'The runtime SDK must not interpret recommended project credential header names');
console.log(`Checked ${files.length} runtime source files: no project credential header names found.`);
