#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

const templateDir = join(process.cwd(), './node_modules/fa-mcp-sdk/cli-template');
const cwd = process.cwd();

const targets = [
  { name: 'FA-MCP-SDK-DOC', src: join(templateDir, 'FA-MCP-SDK-DOC'), dest: join(cwd, 'FA-MCP-SDK-DOC') },
  { name: '.claude', src: join(templateDir, '.claude'), dest: join(cwd, '.claude'), preserve: ['settings.json'] },
];

for (const { name, src, dest, preserve = [] } of targets) {
  if (!existsSync(src)) {
    console.error('Source not found:', src);
    process.exit(1);
  }
  const saved = {};
  for (const file of preserve) {
    const p = join(dest, file);
    if (existsSync(p)) saved[file] = readFileSync(p);
  }
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true });
  }
  cpSync(src, dest, {
    recursive: true,
    filter: (srcPath) => !preserve.includes(basename(srcPath)),
  });
  for (const [file, content] of Object.entries(saved)) {
    const p = join(dest, file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  console.log(`${name} updated`);
}
