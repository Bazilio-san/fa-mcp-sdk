#!/usr/bin/env node
/**
 * Validate a fa-mcp CLI configuration file (YAML or JSON).
 *
 * Usage:
 *   node validate-cli-config.js <path-to-cli-config.yaml>
 *
 * Output (JSON on stdout):
 *   {
 *     "path": "<resolved path>",
 *     "format": "yaml" | "json",
 *     "missing": [ { "name": "project.name", "title": "...", "defaultValue": "" }, ... ],
 *     "filled":  [ { "name": "port", "value": "9876" }, ... ]
 *   }
 *
 * Exit codes:
 *   0 — file read & parsed OK (missing params listed in JSON)
 *   1 — file not found / unreadable
 *   2 — parse error
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const REQUIRED = [
  { name: 'project.name',        title: 'Project name for package.json and MCP server identification' },
  { name: 'project.description', title: 'Project description for package.json' },
  { name: 'project.productName', title: 'Product name displayed in UI' },
  { name: 'port',                title: 'Web server port', defaultValue: '3000' },
  { name: 'projectAbsPath',      title: 'Absolute path where the project will be created' },
];

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: validate-cli-config.js <path-to-cli-config.yaml>');
  process.exit(1);
}

const resolved = path.resolve(filePath);
let raw;
try {
  raw = fs.readFileSync(resolved, 'utf8');
} catch (e) {
  console.error(`Cannot read ${resolved}: ${e.message}`);
  process.exit(1);
}

const ext = path.extname(resolved).toLowerCase();
const format = ext === '.json' ? 'json' : 'yaml';

let data;
try {
  data = format === 'json' ? JSON.parse(raw) : yaml.load(raw, { schema: yaml.DEFAULT_SCHEMA });
} catch (e) {
  console.error(`Parse error: ${e.message}`);
  process.exit(2);
}
data = data || {};

const trim = (v) => (typeof v === 'string' ? v.trim() : v);
const isEmpty = (v) => v === undefined || v === null || trim(v) === '';

const missing = [];
const filled  = [];
for (const p of REQUIRED) {
  const v = data[p.name];
  if (isEmpty(v)) {
    missing.push(p);
  } else {
    filled.push({ name: p.name, value: String(v) });
  }
}

process.stdout.write(JSON.stringify({ path: resolved, format, missing, filled }, null, 2));