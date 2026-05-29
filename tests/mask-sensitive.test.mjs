/**
 * Phase 7 / WI-4 — maskSensitive helper (standard §12.2).
 *
 * Verifies field-name masking, regex masking at any depth, custom replacement (partial masking),
 * non-mutation of the input, and pass-through of primitives.
 *
 * Run after build: node tests/mask-sensitive.test.mjs
 */
import assert from 'node:assert/strict';

import { maskSensitive } from '../dist/core/utils/mask-sensitive.js';

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

test('masks a field by name, leaves others intact', () => {
  const out = maskSensitive({ password: 'p', name: 'a' }, { fieldNames: ['password'] });
  assert.deepEqual(out, { password: '***', name: 'a' });
});

test('field-name match is case-insensitive', () => {
  const out = maskSensitive({ Token: 'secret' }, { fieldNames: ['token'] });
  assert.equal(out.Token, '***');
});

test('does not mutate the input object', () => {
  const input = { password: 'p', name: 'a' };
  const out = maskSensitive(input, { fieldNames: ['password'] });
  assert.equal(input.password, 'p'); // original untouched
  assert.notEqual(out, input);
});

test('regex masking applies at any nesting depth', () => {
  const out = maskSensitive(
    { user: { card: 'pay 4111111111111111 now', items: ['call 4222222222222222'] } },
    { patterns: [/\b\d{13,19}\b/g] },
  );
  assert.equal(out.user.card, 'pay *** now');
  assert.equal(out.user.items[0], 'call ***');
});

test('custom replacement function enables partial masking', () => {
  const out = maskSensitive(
    { card: '4111111111111111' },
    {
      fieldNames: ['card'],
      replacement: (v) => `${v.slice(0, 4)}********${v.slice(-4)}`,
    },
  );
  assert.equal(out.card, '4111********1111');
});

test('field-name masking wins over type — masks non-string value', () => {
  const out = maskSensitive({ ssn: 123456789 }, { fieldNames: ['ssn'] });
  assert.equal(out.ssn, '***');
});

test('primitives pass through unchanged', () => {
  assert.equal(maskSensitive(42, { fieldNames: ['x'] }), 42);
  assert.equal(maskSensitive(true, {}), true);
  assert.equal(maskSensitive(null, {}), null);
});

test('arrays of objects are walked', () => {
  const out = maskSensitive([{ password: 'a' }, { password: 'b', keep: 1 }], { fieldNames: ['password'] });
  assert.deepEqual(out, [{ password: '***' }, { password: '***', keep: 1 }]);
});

test('no rules → deep clone with no changes', () => {
  const out = maskSensitive({ a: { b: 'c' } }, {});
  assert.deepEqual(out, { a: { b: 'c' } });
});

console.log(failed === 0 ? '\nAll mask-sensitive tests passed.' : `\n${failed} test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
