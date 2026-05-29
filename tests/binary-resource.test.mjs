/**
 * Phase 5 / WI-3 — binary resources returned as base64 `blob` (standard §11.4 / §12.2).
 *
 * Drives getResource() directly with an injected project-data global. Text resources must keep
 * the `text` field; binary resources must emit `blob` (valid base64) with the correct mimeType
 * and no `text`. Unknown resource → ResourceNotFoundError (-32002).
 */
import assert from 'node:assert/strict';

// 1×1 transparent PNG, base64.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

globalThis.__MCP_PROJECT_DATA__ = {
  tools: [],
  toolHandler: async () => ({ content: [] }),
  agentBrief: '',
  agentPrompt: '',
  customResources: [
    {
      uri: 'bin://png-b64',
      name: 'png-b64',
      description: 'png as base64',
      mimeType: 'image/png',
      content: { blob: PNG_B64, base64: true },
    },
    {
      uri: 'bin://buf',
      name: 'buf',
      description: 'buffer',
      mimeType: 'application/octet-stream',
      content: { blob: Buffer.from('hello-bytes') },
    },
    { uri: 'txt://plain', name: 'plain', description: 'text', mimeType: 'text/plain', content: 'plain text content' },
  ],
};

const { getResource } = await import('../dist/core/mcp/resources.js');
const ctx = { transport: 'http' };

let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ❌  ${name}\n      ${err.message}`);
  }
};

await test('base64 binary resource → blob (as-is), no text, correct mimeType', async () => {
  const r = await getResource('bin://png-b64', ctx);
  const c = r.contents[0];
  assert.equal(c.blob, PNG_B64);
  assert.equal(c.text, undefined);
  assert.equal(c.mimeType, 'image/png');
  // round-trip decode yields a PNG signature.
  const bytes = Buffer.from(c.blob, 'base64');
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

await test('Buffer binary resource is base64-encoded by the SDK', async () => {
  const r = await getResource('bin://buf', ctx);
  const c = r.contents[0];
  assert.equal(c.text, undefined);
  assert.equal(c.blob, Buffer.from('hello-bytes').toString('base64'));
  assert.equal(Buffer.from(c.blob, 'base64').toString('utf-8'), 'hello-bytes');
});

await test('text resource still returns text, no blob', async () => {
  const r = await getResource('txt://plain', ctx);
  const c = r.contents[0];
  assert.equal(c.text, 'plain text content');
  assert.equal(c.blob, undefined);
});

await test('built-in text resource project://version returns text', async () => {
  const r = await getResource('project://version', ctx);
  assert.equal(typeof r.contents[0].text, 'string');
  assert.equal(r.contents[0].blob, undefined);
});

await test('unknown resource → ResourceNotFoundError (-32002)', async () => {
  await assert.rejects(
    () => getResource('nope://missing', ctx),
    (err) => err.jsonRpcCode === -32002,
  );
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll binary-resource tests passed!');
