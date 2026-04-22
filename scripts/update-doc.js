#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

const templateDir = join(process.cwd(), './node_modules/fa-mcp-sdk/cli-template');
const cwd = process.cwd();

const targets = [
  { name: 'FA-MCP-SDK-DOC', src: join(templateDir, 'FA-MCP-SDK-DOC'), dest: join(cwd, 'FA-MCP-SDK-DOC') },
  { name: '.claude', src: join(templateDir, '.claude'), dest: join(cwd, '.claude') },
];

for (const { name, src, dest } of targets) {
  if (!existsSync(src)) {
    console.error('Source not found:', src);
    process.exit(1);
  }
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true });
  }
  cpSync(src, dest, { recursive: true });
  console.log(`${name} updated`);
}
