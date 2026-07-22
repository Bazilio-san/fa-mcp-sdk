import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(root, path), 'utf8');

const packageJson = JSON.parse(await read('package.json'));
assert.equal(packageJson.dependencies.tsoa, undefined, 'the compiler-only tsoa meta-package must not ship at runtime');
assert.match(packageJson.dependencies['@tsoa/runtime'], /^\^6\./);
assert.match(packageJson.devDependencies['@tsoa/cli'], /^\^6\./);

const openApiSource = await read('src/core/web/openapi.ts');
assert.match(openApiSource, /projectRequire\('@tsoa\/cli'\)/);
assert.doesNotMatch(openApiSource, /import\('tsoa'\)/);

const templateRouter = await read('src/template/api/router.ts');
assert.match(templateRouter, /from '@tsoa\/runtime'/);
assert.doesNotMatch(templateRouter, /from 'tsoa'/);

const templatePackage = JSON.parse(await read('cli-template/package.json'));
assert.match(templatePackage.dependencies['@tsoa/runtime'], /^\^6\./);
assert.match(templatePackage.devDependencies['@tsoa/cli'], /^\^6\./);
assert.equal(templatePackage.scripts['openapi:spec'], 'tsoa spec');

const expectedBearerScheme = { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' };
for (const configPath of ['tsoa.json', 'cli-template/tsoa.json']) {
  const tsoaConfig = JSON.parse(await read(configPath));
  assert.deepEqual(
    tsoaConfig.spec.securityDefinitions?.bearerAuth,
    expectedBearerScheme,
    `${configPath} must declare the bearerAuth scheme referenced by protected endpoints`,
  );
}

const { configureOpenAPI } = await import('../dist/core/web/openapi.js');
const readOnlyCwd = await mkdtemp(join(tmpdir(), 'fa-mcp-openapi-readonly-'));
const originalCwd = process.cwd();
try {
  await chmod(readOnlyCwd, 0o500);
  process.chdir(readOnlyCwd);
  const configured = await configureOpenAPI(Router());
  assert.ok(configured?.swaggerSpecs, 'an in-memory fallback must be returned on a read-only filesystem');
  assert.equal(configured.swaggerSpecs.openapi, '3.0.0');
  assert.ok(configured.swaggerSpecs.paths['/api/health']);
} finally {
  process.chdir(originalCwd);
  await chmod(readOnlyCwd, 0o700);
  await rm(readOnlyCwd, { recursive: true, force: true });
}

console.log('OpenAPI production dependency tests passed.');
process.exit(0);
