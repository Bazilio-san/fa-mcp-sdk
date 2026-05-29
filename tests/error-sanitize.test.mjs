/**
 * Phase 5 / WI-2 — outward error-message sanitization (standard §13.3 / Appendix C.3).
 *
 * Unrecognized internal errors must NOT leak their text outward (collapse to "Internal error");
 * recognized domain errors keep their developer-authored message; absolute paths are scrubbed.
 *
 * Pure unit checks against the compiled SDK — no server spawn required.
 */
import assert from 'node:assert/strict';

import { sanitizeOutwardMessage, toMcpError, createJsonRpcErrorResponse } from '../dist/core/errors/errors.js';
import { PayloadTooLargeError, RateLimitedError, ResourceNotFoundError } from '../dist/core/errors/specific-errors.js';
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

test('toMcpError passes an already-McpError through with its numeric code', () => {
  const passthrough = toMcpError(toMcpError(new RateLimitedError('again', 3)));
  assert.equal(passthrough.code, -32003);
});

test('createJsonRpcErrorResponse hides a raw internal error text', () => {
  const body = createJsonRpcErrorResponse(new Error('SELECT * FROM users WHERE pwd=... at /var/app/db.js'));
  assert.equal(body.error.code, -32603);
  assert.equal(body.error.message, 'Internal error');
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll error-sanitize tests passed!');
