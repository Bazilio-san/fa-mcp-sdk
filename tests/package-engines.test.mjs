import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function minimumSupportedVersion(range, label) {
  const alternatives = String(range)
    .split('||')
    .map((branch) => {
      if (/^\s*(?:\*|x)\s*$/i.test(branch)) {
        return [0, 0, 0];
      }
      const match = branch.match(/(?:^|\s)(?:>=|>|~|\^|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
      assert.ok(match, `${label} has an unsupported Node.js engine range: ${range}`);
      return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
    });
  return alternatives.sort(compareVersions)[0];
}

const sdkPackage = await readJson(join(root, 'package.json'));
const templatePackage = await readJson(join(root, 'cli-template/package.json'));
const sdkFloor = minimumSupportedVersion(sdkPackage.engines?.node, 'fa-mcp-sdk');
const templateFloor = minimumSupportedVersion(templatePackage.engines?.node, 'cli-template');

assert.ok(compareVersions(sdkFloor, [20, 0, 0]) >= 0, 'fa-mcp-sdk must require Node.js 20 or newer');
assert.ok(compareVersions(templateFloor, sdkFloor) >= 0, 'the generated template must not understate the SDK engine');

for (const dependencyName of Object.keys(sdkPackage.dependencies)) {
  const dependencyPackage = await readJson(join(root, 'node_modules', ...dependencyName.split('/'), 'package.json'));
  const dependencyEngine = dependencyPackage.engines?.node;
  if (!dependencyEngine) {
    continue;
  }
  const dependencyFloor = minimumSupportedVersion(dependencyEngine, `${dependencyName}@${dependencyPackage.version}`);
  assert.ok(
    compareVersions(sdkFloor, dependencyFloor) >= 0,
    `fa-mcp-sdk engine ${sdkPackage.engines.node} is lower than ${dependencyName}@${dependencyPackage.version} ` +
      `engine ${dependencyEngine}`,
  );
}

console.log('SDK and template Node.js engines cover every installed production dependency.');
