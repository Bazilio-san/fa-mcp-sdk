/**
 * Phase 5 / WI-4 — error codes -32006 (Upstream unavailable) and -32007 (Conflict),
 * plus the DB error mapping that turns connection failures into UpstreamUnavailableError.
 *
 * Pure unit checks against the compiled SDK — no server spawn required.
 */
import assert from 'node:assert/strict';

import { MCP_ERROR_CODES, UpstreamUnavailableError, ConflictError } from '../dist/core/errors/specific-errors.js';
import { createJsonRpcErrorResponse } from '../dist/core/errors/errors.js';
import { mapDbError } from '../dist/core/db/pg-db.js';

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

test('MCP_ERROR_CODES contains -32006 and -32007', () => {
  assert.equal(MCP_ERROR_CODES.UPSTREAM_UNAVAILABLE, -32006);
  assert.equal(MCP_ERROR_CODES.CONFLICT, -32007);
});

test('UpstreamUnavailableError → code -32006, HTTP 503, data.reason', () => {
  const e = new UpstreamUnavailableError('DB down', { dependency: 'postgres' });
  assert.equal(e.jsonRpcCode, -32006);
  assert.equal(e.statusCode, 503);
  assert.equal(e.data.reason, 'DB down');
  assert.equal(e.data.dependency, 'postgres');
});

test('ConflictError → code -32007, HTTP 409, data.reason', () => {
  const e = new ConflictError('version mismatch');
  assert.equal(e.jsonRpcCode, -32007);
  assert.equal(e.statusCode, 409);
  assert.equal(e.data.reason, 'version mismatch');
});

test('createJsonRpcErrorResponse keeps the -32006 code and safe message', () => {
  const body = createJsonRpcErrorResponse(new UpstreamUnavailableError('Database "main" unavailable'));
  assert.equal(body.error.code, -32006);
  assert.equal(body.error.message, 'Database "main" unavailable');
  assert.equal(body.error.data.reason, 'Database "main" unavailable');
});

test('mapDbError maps a connection refusal to UpstreamUnavailableError', () => {
  const mapped = mapDbError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432' });
  assert.ok(mapped instanceof UpstreamUnavailableError);
  assert.equal(mapped.jsonRpcCode, -32006);
  assert.equal(mapped.data.dependency, 'postgres');
});

test('mapDbError maps SQLSTATE class 08 to UpstreamUnavailableError', () => {
  const mapped = mapDbError({ code: '08006', message: 'connection terminated unexpectedly' });
  assert.ok(mapped instanceof UpstreamUnavailableError);
});

test('mapDbError passes a constraint violation through unchanged', () => {
  const orig = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
  const mapped = mapDbError(orig);
  assert.ok(!(mapped instanceof UpstreamUnavailableError));
  assert.equal(mapped, orig);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll error-code tests passed!');
