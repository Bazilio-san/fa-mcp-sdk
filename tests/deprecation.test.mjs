/**
 * Standard §17.2 — deprecation helpers behave as documented.
 *
 * Pure unit checks against the compiled SDK — no server spawn required.
 */
import assert from 'node:assert/strict';

import {
  applyDeprecationToDescription,
  assertDeprecationConsistency,
  readDeprecation,
  warnDeprecatedUsage,
  _resetDeprecationWarnState,
} from '../dist/core/mcp/deprecation.js';

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

test('applyDeprecationToDescription adds the prefix when missing', () => {
  const out = applyDeprecationToDescription('Original.', { until: '2026-08-28', replacedBy: 'new_tool' });
  assert.equal(out, '[DEPRECATED until 2026-08-28, use new_tool] Original.');
});

test('applyDeprecationToDescription is idempotent', () => {
  const once = applyDeprecationToDescription('Original.', { until: '2026-08-28' });
  const twice = applyDeprecationToDescription(once, { until: '2026-08-28' });
  assert.equal(once, twice);
});

test('readDeprecation reads from top-level field', () => {
  const info = readDeprecation({ deprecated: { until: '2027-01-01' } });
  assert.deepEqual(info, { until: '2027-01-01' });
});

test('readDeprecation reads from _meta.deprecated', () => {
  const info = readDeprecation({ _meta: { deprecated: { until: '2027-01-01', replacedBy: 'foo' } } });
  assert.deepEqual(info, { until: '2027-01-01', replacedBy: 'foo' });
});

test('readDeprecation returns undefined when not declared', () => {
  assert.equal(readDeprecation({}), undefined);
  assert.equal(readDeprecation(null), undefined);
});

test('warnDeprecatedUsage emits once per (kind,name) within an hour', () => {
  _resetDeprecationWarnState();
  const first = warnDeprecatedUsage('tool', 'sample', { until: '2099-01-01' });
  const second = warnDeprecatedUsage('tool', 'sample', { until: '2099-01-01' });
  assert.equal(first, true);
  assert.equal(second, false);
});

test('warnDeprecatedUsage with no info is a no-op', () => {
  _resetDeprecationWarnState();
  const emitted = warnDeprecatedUsage('tool', 'x', undefined);
  assert.equal(emitted, false);
});

test('assertDeprecationConsistency tolerates valid future date', () => {
  // Implementation logs to stderr; the test verifies no throw.
  assert.doesNotThrow(() => {
    assertDeprecationConsistency('tool', 'sample', { until: '2099-01-01' });
  });
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll deprecation tests passed!');
