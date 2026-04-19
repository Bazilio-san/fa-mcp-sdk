#!/usr/bin/env node
/**
 * Thin wrapper around POST /agent-tester/api/chat/test — used by the deploy-mcp skill
 * to exercise the freshly-built MCP server through the full agent loop.
 *
 * Usage:
 *   node headless-test.js --port 9876 --message "What is the EUR/USD rate?" [options]
 *
 * Options:
 *   --port <n>           Web server port (required)
 *   --message <text>     User message to send (required)
 *   --auth <header>      Full Authorization header value (e.g. "Bearer xxxx"). Optional.
 *   --verbose            Include per-turn LLM request/response in trace
 *   --max-result <n>     Max chars per tool result (default 4000)
 *   --max-trace <n>      Max total trace size (default 50000)
 *   --agent-prompt <s>   Override system prompt for this request
 *   --model <name>       Model name (default: let server choose)
 *   --timeout <ms>       Request timeout (default 120000)
 *
 * Prints the JSON response to stdout. Exit code 0 on 2xx, non-zero otherwise.
 */

import http from 'http';

function getOpt (flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function hasFlag (flag) { return process.argv.includes(flag); }

const port    = getOpt('--port');
const message = getOpt('--message');
const auth    = getOpt('--auth');
const verbose = hasFlag('--verbose');
const maxResult = getOpt('--max-result', '4000');
const maxTrace  = getOpt('--max-trace', '50000');
const agentPrompt = getOpt('--agent-prompt');
const model   = getOpt('--model');
const timeout = Number(getOpt('--timeout', '120000'));

if (!port || !message) {
  console.error('Usage: headless-test.js --port <n> --message "<text>" [--auth "Bearer ..."] [--verbose] [--model <name>]');
  process.exit(2);
}

const body = {
  message,
  mcpConfig: { url: `http://localhost:${port}/mcp`, transport: 'http' },
};
if (auth) body.mcpConfig.headers = { Authorization: auth };
if (agentPrompt) body.agentPrompt = agentPrompt;
if (model) body.modelConfig = { model };

const qs = `?verbose=${verbose}&maxResultChars=${maxResult}&maxTraceChars=${maxTrace}`;
const payload = JSON.stringify(body);

const req = http.request({
  hostname: 'localhost',
  port,
  path: `/agent-tester/api/chat/test${qs}`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...(auth ? { Authorization: auth } : {}),
  },
  timeout,
}, (res) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    process.stdout.write(text);
    process.exit(res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
  });
});
req.on('error', (e) => { console.error(`request error: ${e.message}`); process.exit(1); });
req.on('timeout', () => { req.destroy(new Error('timeout')); });
req.write(payload);
req.end();