#!/usr/bin/env node
/**
 * Set one or more flat keys in a fa-mcp CLI config file (YAML or JSON).
 *
 * The fa-mcp CLI expects dotted keys at the top level (e.g. "project.name", "consul.service.enable")
 * — NOT nested YAML structures. This helper preserves that flat form.
 *
 * Usage:
 *   node set-cli-config.js <path> <key> <value> [<key> <value> ...]
 *
 * Example:
 *   node set-cli-config.js cli-config.yaml project.name my-mcp port 9876
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const args = process.argv.slice(2);
if (args.length < 3 || (args.length - 1) % 2 !== 0) {
  console.error('Usage: set-cli-config.js <path> <key> <value> [<key> <value> ...]');
  process.exit(1);
}

const filePath = path.resolve(args[0]);
const pairs = [];
for (let i = 1; i < args.length; i += 2) pairs.push([args[i], args[i + 1]]);

const ext = path.extname(filePath).toLowerCase();
const format = ext === '.json' ? 'json' : 'yaml';

let data = {};
if (fs.existsSync(filePath)) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw.trim()) {
    data = format === 'json' ? JSON.parse(raw) : (yaml.load(raw, { schema: yaml.DEFAULT_SCHEMA }) || {});
  }
}

for (const [k, v] of pairs) data[k] = v;

const out = format === 'json'
  ? JSON.stringify(data, null, 2) + '\n'
  : yaml.dump(data, { lineWidth: 120, quotingType: '"' });

fs.writeFileSync(filePath, out, 'utf8');
console.log(`Updated ${filePath}: ${pairs.map(([k]) => k).join(', ')}`);