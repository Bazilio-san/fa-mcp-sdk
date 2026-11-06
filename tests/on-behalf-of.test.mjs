import assert from 'node:assert/strict';

import { getOnBehalfOfIdentity, parseOnBehalfOfUser } from '../dist/core/index.js';

assert.deepStrictEqual(parseOnBehalfOfUser('Alice'), {
  raw: 'Alice',
  username: 'alice',
  normalized: 'alice',
});
assert.deepStrictEqual(parseOnBehalfOfUser(' OFFICE\\Alice '), {
  raw: 'OFFICE\\Alice',
  domain: 'office',
  username: 'alice',
  normalized: 'office\\alice',
});
assert.deepStrictEqual(parseOnBehalfOfUser('OFFICE/Alice'), {
  raw: 'OFFICE/Alice',
  domain: 'office',
  username: 'alice',
  normalized: 'office\\alice',
});
assert.deepStrictEqual(getOnBehalfOfIdentity({ 'x-on-behalf-of-user': 'WTE/bob' }), {
  raw: 'WTE/bob',
  domain: 'wte',
  username: 'bob',
  normalized: 'wte\\bob',
});

for (const invalid of [
  undefined,
  '',
  ' ',
  '/alice',
  'office/',
  'office\\team/alice',
  'a\\b\\c',
  'a b',
  'office \\alice',
  'office\\ alice',
]) {
  assert.strictEqual(parseOnBehalfOfUser(invalid), undefined, `must reject ${JSON.stringify(invalid)}`);
}

console.log('on-behalf-of identity tests passed');
process.exit(0);
