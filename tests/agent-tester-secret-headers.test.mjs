import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const script = await readFile('src/core/web/static/agent-tester/script.js', 'utf8');

test('secret header inputs use password controls without browser persistence', () => {
  assert.match(script, /type="\$\{isSecret \? 'password' : 'text'\}"/);
  assert.match(script, /autocomplete="\$\{isSecret \? 'new-password' : 'off'\}"/);
  assert.match(script, /data-secret="\$\{isSecret\}"/);
  assert.match(script, /filter\(\(\[name\]\) => !secretNames\.has\(name\.toLowerCase\(\)\)\)/);
});

test('secret values remain available to the current request and are explicitly cleared', () => {
  assert.match(script, /headers\[header\.name\] = input\.value\.trim\(\)/);
  assert.match(script, /clearSecretHeaderValues\(\)/);
  assert.match(script, /querySelectorAll\('input\[data-secret="true"\]'\)/);
  assert.match(script, /delete holder\[name\]/);
  assert.match(script, /handleServerUrlChange\(\)[\s\S]*?this\.clearSecretHeaderValues\(\)/);
  assert.match(script, /async disconnectServer\(\)[\s\S]*?this\.clearSecretHeaderValues\(\)/);
  assert.match(script, /async _logout\(\)[\s\S]*?clearSecretHeaderValues\(\)/);
});
