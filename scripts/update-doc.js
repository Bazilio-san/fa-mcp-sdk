#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const src = join(__dirname, '..', 'cli-template', 'FA-MCP-SDK-DOC');
const dest = join(process.cwd(), 'FA-MCP-SDK-DOC');

if (!existsSync(src)) {
  console.error('Source not found:', src);
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true });
}

cpSync(src, dest, { recursive: true });
console.log('FA-MCP-SDK-DOC updated');
