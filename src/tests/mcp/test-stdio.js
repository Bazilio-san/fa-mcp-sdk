#!/usr/bin/env node

/**
 * STDIO transport tests for the template MCP server (src/template)
 * Uses a minimal NDJSON JSON-RPC client over child_process stdio
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import chalk from 'chalk';
import TEMPLATE_TESTS from './test-cases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../../../');

const serverPath = join(projectRoot, 'dist/template/start.js');

const SHOW_IN = process.env.TEST_SHOW_IN === 'true';
const SHOW_OUT = process.env.TEST_SHOW_OUT === 'true';
const SHOW_ERR = process.env.TEST_SHOW_ERR === 'true';

class StdioMcpClient {
  constructor (proc) {
    this.proc = proc;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';

    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      this.processLines();
    });
    this.proc.stderr.on('data', (data) => {
      if (SHOW_ERR) {
        console.error(chalk.gray(String(data)));
      }
    });
  }

  processLines () {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s) {continue;}
      try {
        const msg = JSON.parse(s);
        if (SHOW_IN) {
          console.log(chalk.bgYellow('IN ') + s);
        }
        if (typeof msg.id === 'number' && (msg.result !== undefined || msg.error)) {
          const p = this.pending.get(msg.id);
          if (p) {
            clearTimeout(p.t);
            this.pending.delete(msg.id);
            if (msg.error) { p.reject(new Error(msg.error?.message || 'MCP Error')); } else { p.resolve(msg.result); }
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  send (method, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    const req = { jsonrpc: '2.0', id, method, params };
    const text = JSON.stringify(req) + '\n';
    if (SHOW_OUT) {
      console.log(chalk.bgBlue('OUT') + ' ' + text.trim());
    }
    this.proc.stdin.write(text);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, t });
    });
  }

  listPrompts () { return this.send('prompts/list'); }
  getPrompt (name, args = {}) { return this.send('prompts/get', { name, arguments: args }); }
  listResources () { return this.send('resources/list'); }
  readResource (uri) { return this.send('resources/read', { uri }); }
  listTools () { return this.send('tools/list'); }
  callTool (name, args = {}) { return this.send('tools/call', { name, arguments: args }); }
}

async function runTestGroup (title, tests, client) {
  console.log(`\n${title}:`);
  let passed = 0;
  for (const test of tests) {
    const name = (await test).name || 'test';
    try {
      const res = await test(client);
      if (res.passed) {
        console.log(`  ✅  ${res.name}`);
        passed++;
      } else {
        console.log(`  ❌  ${res.name}`);
        if (res.details) {
          console.log('     ', res.details);
        }
      }
    } catch (e) {
      console.log(`  ❌  ${name}:`, e.message);
    }
  }
  console.log(`  Result: ${passed}/${tests.length} passed`);
  return passed;
}

async function main () {
  console.log('🧪 STDIO tests for template MCP server');
  console.log('='.repeat(60));

  const proc = spawn('node', [serverPath, 'stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const client = new StdioMcpClient(proc);

  try {
    // Initialize handshake (optional for stdio server; safe to send)
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'stdio-test', version: '1.0.0' },
    }).catch(() => undefined);

    const p1 = await runTestGroup('Prompts', TEMPLATE_TESTS.prompts, client);
    const p2 = await runTestGroup('Resources', TEMPLATE_TESTS.resources, client);
    const p3 = await runTestGroup('Tools', TEMPLATE_TESTS.tools, client);

    const total = TEMPLATE_TESTS.prompts.length + TEMPLATE_TESTS.resources.length + TEMPLATE_TESTS.tools.length;
    const sum = p1 + p2 + p3;
    console.log(`\nSummary: ${sum}/${total} tests passed`);
  } finally {
    try { proc.kill(); } catch {}
  }
}

main().catch((e) => {
  console.error('Test failed:', e?.message || e);
  process.exit(1);
});
