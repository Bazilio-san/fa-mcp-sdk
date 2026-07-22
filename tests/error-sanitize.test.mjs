/**
 * Phase 5 / WI-2 — outward error-message sanitization (standard §13.3 / Appendix C.3).
 *
 * Unrecognized internal errors must NOT leak their text outward (collapse to "Internal error");
 * recognized domain errors keep their developer-authored message; absolute paths are scrubbed.
 *
 * Pure unit checks against the compiled SDK — no server spawn required.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { McpError } from '@modelcontextprotocol/sdk/types.js';

import { sanitizeOutwardMessage, toMcpError, createJsonRpcErrorResponse } from '../dist/core/errors/errors.js';
import { PayloadTooLargeError, RateLimitedError, ResourceNotFoundError } from '../dist/core/errors/specific-errors.js';
import { BaseMcpError } from '../dist/core/errors/BaseMcpError.js';
import { maskLogText } from '../dist/core/logger.js';
import { ValidationError } from '../dist/core/errors/ValidationError.js';
import { ServerError } from '../dist/core/errors/errors.js';

let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`  ✅  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ❌  ${name}\n      ${err.message}`);
  }
};

test('unknown internal error collapses to "Internal error"', () => {
  const out = sanitizeOutwardMessage(new Error('ENOENT: open D:\\secret\\config.yaml'));
  assert.equal(out, 'Internal error');
});

test('recognized domain error keeps its message', () => {
  assert.equal(sanitizeOutwardMessage(new RateLimitedError('Slow down', 5)), 'Slow down');
});

test('hostile text in a coded domain error is replaced with a fixed public message', () => {
  const hostile = 'Bearer eyJ.secret.signature user@example.test https://internal.example/private';
  const outward = sanitizeOutwardMessage(new ResourceNotFoundError(hostile, { reason: hostile, uri: hostile }));
  assert.equal(outward, 'Resource not found');
  assert.doesNotMatch(outward, /eyJ|example|https/i);
});

test('ValidationError keeps its message (code -32602)', () => {
  const e = new ValidationError('Project is required');
  assert.equal(sanitizeOutwardMessage(e), 'Project is required');
  assert.equal(toMcpError(e).code, -32602);
});

test('generic ServerError (no explicit code) collapses to Internal error', () => {
  assert.equal(sanitizeOutwardMessage(new ServerError('SELECT * FROM secret at /var/app')), 'Internal error');
});

test('absolute Windows path is scrubbed even from a "safe" error', () => {
  const out = sanitizeOutwardMessage(new PayloadTooLargeError('Too big C:\\Users\\bob\\secret.txt'));
  assert.ok(!out.includes('C:\\Users'), `path leaked: ${out}`);
  assert.ok(out.includes('[path]'));
});

test('absolute POSIX path is scrubbed', () => {
  const out = sanitizeOutwardMessage(new PayloadTooLargeError('failed at /home/app/secret.key'));
  assert.ok(!out.includes('/home/app'), `path leaked: ${out}`);
  assert.ok(out.includes('[path]'));
});

test('toMcpError maps an unknown error to -32603 / Internal error', () => {
  const e = toMcpError(new Error('boom from /usr/lib/internal.js'));
  assert.equal(e.code, -32603);
  assert.equal(e.message, 'MCP error -32603: Internal error');
});

test('toMcpError maps ResourceNotFoundError to -32002', () => {
  const e = toMcpError(new ResourceNotFoundError('Unknown resource', { uri: 'x://y', reason: 'unknown_resource' }));
  assert.equal(e.code, -32002);
});

test('toMcpError preserves an already-McpError numeric code through a sanitized copy', () => {
  const passthrough = toMcpError(toMcpError(new RateLimitedError('again', 3)));
  assert.equal(passthrough.code, -32003);
});

test('toMcpError preserves bounded input-schema diagnostics without reflecting values', () => {
  const error = toMcpError(
    new McpError(-32602, 'raw text is not trusted', {
      field: '/amount',
      reason: 'type',
      errorCount: 1,
      errors: [{ field: '/amount', reason: 'type', message: '/amount: expected number, got string' }],
    }),
  );
  assert.equal(error.code, -32602);
  assert.match(error.message, /Invalid params: \/amount: expected number, got string/);
  assert.deepEqual(error.data, {
    field: '/amount',
    reason: 'type',
    errorCount: 1,
    errors: [{ field: '/amount', reason: 'type', message: '/amount: expected number, got string' }],
  });
});

test('toMcpError rejects fabricated validation diagnostics that could reflect caller text', () => {
  const error = toMcpError(
    new McpError(-32602, 'ignored', {
      field: '/amount',
      reason: 'type',
      errors: [{ field: '/amount', reason: 'type', message: '/amount: private-caller-text' }],
    }),
  );
  assert.equal(error.message, 'MCP error -32602: Invalid params');
  assert.deepEqual(error.data, { field: '/amount', reason: 'type' });
  assert.doesNotMatch(JSON.stringify(error), /private-caller-text/);
});

test('toMcpError sanitizes hostile McpError message and arbitrary data', () => {
  const secret = 'Bearer eyJ.secret.signature user@example.test https://internal.example/private';
  const sanitized = toMcpError(new McpError(-32603, secret, { raw: secret, uri: secret, reason: secret }));
  assert.equal(sanitized.code, -32603);
  assert.equal(sanitized.message, 'MCP error -32603: Internal error');
  assert.equal(sanitized.data, undefined);
  assert.doesNotMatch(JSON.stringify(sanitized), /eyJ|user@example|internal\.example/i);
});

test('error data is limited to canonical safe scalar fields', () => {
  const body = createJsonRpcErrorResponse(
    new ResourceNotFoundError('Unknown resource', {
      reason: 'unknown_resource',
      uri: 'https://internal.example/user@example.test',
      taskId: 'attacker-controlled-task-id',
      missing: ['private.scope'],
    }),
  );
  assert.deepEqual(body.error.data, { reason: 'unknown_resource' });
});

test('BaseMcpError JSON serialization never includes stack or arbitrary transport metadata', () => {
  const serialized = new BaseMcpError('TEST', 'safe').toJSON();
  assert.equal('stack' in serialized, false);
});

test('createJsonRpcErrorResponse hides a raw internal error text', () => {
  const body = createJsonRpcErrorResponse(new Error('SELECT * FROM users WHERE pwd=... at /var/app/db.js'));
  assert.equal(body.error.code, -32603);
  assert.equal(body.error.message, 'Internal error');
});

test('unknown error logs contain only safe identifiers and never raw secrets, PII, URLs or stack', () => {
  const source = `
    const { createJsonRpcErrorResponse } = await import('./dist/core/errors/errors.js');
    const { runWithRequestContext } = await import('./dist/core/web/request-id.js');
    const secret = 'Bearer eyJhbGciOiJIUzI1NiJ9.top-secret.signature user@example.test postgresql://admin:pw@db/private /var/private/key';
    const error = new Error(secret);
    error.code = 'UPSTREAM_FAILURE';
    const body = runWithRequestContext({ requestId: 'request-safe-123' }, () => createJsonRpcErrorResponse(error));
    process.stdout.write(JSON.stringify(body));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NODE_CONFIG: JSON.stringify({ mcp: { transportType: 'stdio' } }),
    },
  });
  assert.equal(child.status, 0, child.stderr);
  const captured = `${child.stdout}\n${child.stderr}`;
  assert.match(captured, /request-safe-123/);
  assert.match(captured, /name=Error/);
  assert.match(captured, /code=UPSTREAM_FAILURE/);
  assert.match(captured, /Internal error/);
  assert.doesNotMatch(captured, /eyJhbGci|top-secret|user@example|postgresql:\/\/|\/var\/private|Error: Bearer/);
});

test('LLM availability check never prints a partial API key', () => {
  const source = readFileSync('src/core/agent-tester/check-llm.ts', 'utf8');
  assert.doesNotMatch(source, /apiKey\.(?:sub(?:string|str)|slice)\s*\(/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*apiKey/i);
});

test('production logger settings cannot bypass the mandatory masker', () => {
  const source = `
    const { applyLoggerSettings } = await import('./dist/core/logger.js');
    applyLoggerSettings({ level: 'info' });
    for (const overrides of [
      { maskValuesRegEx: [] },
      { maskValuesOfKeys: [] },
      { overwrite: { mask: (args) => args } },
    ]) {
      try {
        applyLoggerSettings(overrides);
        process.exit(2);
      } catch (error) {
        if (error.message !== 'loggerSettings cannot override secret-masking controls in production.') process.exit(3);
      }
    }
    process.stdout.write('production masking overrides rejected');
    process.exit(0);
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', NODE_CONSUL_ENV: 'production' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'production masking overrides rejected');
});

test('shared logger masker removes secrets, PII, URLs and paths used by stdio logs', () => {
  const captured = maskLogText(
    'Bearer eyJhbGci.signature user@example.test https://internal.example/private /var/private/key token=s3cr3t',
  );
  assert.match(captured, /REDACTED/);
  assert.doesNotMatch(captured, /eyJhbGci|user@example|internal\.example|\/var\/private|s3cr3t/);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll error-sanitize tests passed!');
process.exit(0);
