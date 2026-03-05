/**
 * Tests for ip-check — IP parsing and CIDR matching.
 * Run after build: node tests/ip-check.test.mjs
 */
import { parseIpList, isIpAllowed } from '../dist/core/auth/ip-check.js';
import assert from 'node:assert';

// ===== parseIpList =====

assert.deepStrictEqual(parseIpList(''), [], 'empty string');
assert.deepStrictEqual(parseIpList('   '), [], 'whitespace-only');
assert.deepStrictEqual(parseIpList('192.168.1.1, 10.0.0.1'), ['192.168.1.1', '10.0.0.1'], 'comma-separated');
assert.deepStrictEqual(parseIpList('192.168.1.1;10.0.0.1'), ['192.168.1.1', '10.0.0.1'], 'semicolon-separated');
assert.deepStrictEqual(parseIpList('192.168.1.1 10.0.0.1'), ['192.168.1.1', '10.0.0.1'], 'space-separated');
assert.deepStrictEqual(
  parseIpList('192.168.1.1, 10.0.0.0/8; 172.16.0.0/12 ::1'),
  ['192.168.1.1', '10.0.0.0/8', '172.16.0.0/12', '::1'],
  'mixed separators',
);

// ===== isIpAllowed — exact IPv4 =====

assert.strictEqual(isIpAllowed('192.168.1.100', ['192.168.1.100']), true, 'exact match');
assert.strictEqual(isIpAllowed('192.168.1.101', ['192.168.1.100']), false, 'different IP');
assert.strictEqual(isIpAllowed('10.0.0.5', ['192.168.1.1', '10.0.0.5', '172.16.0.1']), true, 'match among multiple');

// ===== isIpAllowed — CIDR IPv4 =====

assert.strictEqual(isIpAllowed('10.0.0.5', ['10.0.0.0/24']), true, '/24 match');
assert.strictEqual(isIpAllowed('10.0.1.5', ['10.0.0.0/24']), false, '/24 no match');
assert.strictEqual(isIpAllowed('10.255.255.255', ['10.0.0.0/8']), true, '/8 match');
assert.strictEqual(isIpAllowed('11.0.0.1', ['10.0.0.0/8']), false, '/8 no match');
assert.strictEqual(isIpAllowed('172.16.5.10', ['172.16.0.0/16']), true, '/16 match');
assert.strictEqual(isIpAllowed('192.168.1.1', ['192.168.1.1/32']), true, '/32 match');
assert.strictEqual(isIpAllowed('192.168.1.2', ['192.168.1.1/32']), false, '/32 no match');
assert.strictEqual(isIpAllowed('1.2.3.4', ['0.0.0.0/0']), true, '/0 matches all');

// ===== isIpAllowed — IPv6 =====

assert.strictEqual(isIpAllowed('::1', ['::1']), true, 'exact IPv6');
assert.strictEqual(isIpAllowed('::2', ['::1']), false, 'different IPv6');
assert.strictEqual(isIpAllowed('fe80::1', ['fe80::/10']), true, 'IPv6 CIDR match');
assert.strictEqual(isIpAllowed('fe00::1', ['fec0::/10']), false, 'IPv6 CIDR no match');

// ===== isIpAllowed — IPv4-mapped IPv6 =====

assert.strictEqual(isIpAllowed('::ffff:192.168.1.1', ['192.168.1.1']), true, 'mapped → plain');
assert.strictEqual(isIpAllowed('192.168.1.1', ['::ffff:192.168.1.1']), true, 'plain → mapped');
assert.strictEqual(isIpAllowed('::ffff:10.0.0.5', ['10.0.0.0/24']), true, 'mapped + CIDR');

// ===== Edge cases =====

assert.strictEqual(isIpAllowed('', ['192.168.1.1']), false, 'empty clientIp');
assert.strictEqual(isIpAllowed('192.168.1.1', []), false, 'empty allowedIps');
assert.strictEqual(isIpAllowed('192.168.1.1', ['not-an-ip']), false, 'invalid entry');

console.log('All ip-check tests passed!');
