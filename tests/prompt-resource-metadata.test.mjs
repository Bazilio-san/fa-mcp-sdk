/**
 * Phase 7 / WI-1 + WI-2 — prompt/resource UI metadata (standard §10.5 / §11.3).
 *
 * Drives getPromptsList() / getResourcesList() with an injected project-data global:
 *  - built-in prompts agent_brief / agent_prompt expose `title`;
 *  - a custom prompt declaring `icons` round-trips them in prompts/list;
 *  - built-in resources expose `title` and a computed `size`;
 *  - a custom resource declaring `size` / `icons` round-trips them in resources/list;
 *  - prompts/resources without the new fields serialize as before (fields absent).
 *
 * Run after build: node tests/prompt-resource-metadata.test.mjs
 */
import assert from 'node:assert/strict';

globalThis.__MCP_PROJECT_DATA__ = {
  tools: [],
  toolHandler: async () => ({ content: [] }),
  agentBrief: 'BRIEF-TEXT',
  agentPrompt: 'PROMPT-TEXT',
  customPrompts: [
    {
      name: 'with_icon',
      title: 'With icon',
      icons: [{ src: 'https://example.com/i.png', mimeType: 'image/png', sizes: '48x48' }],
      description: 'prompt with icon',
      arguments: [],
      content: 'x',
    },
    {
      name: 'plain_prompt',
      description: 'prompt without title/icons',
      arguments: [],
      content: 'y',
    },
  ],
  customResources: [
    {
      uri: 'cfg://sized',
      name: 'sized',
      title: 'Sized resource',
      description: 'resource with explicit size and icons',
      mimeType: 'application/json',
      size: 123,
      icons: [{ src: 'https://example.com/r.svg', mimeType: 'image/svg+xml' }],
      content: '{"k":1}',
    },
    {
      uri: 'cfg://plain',
      name: 'plain',
      description: 'resource without new fields',
      mimeType: 'text/plain',
      content: 'abc',
    },
  ],
};

const { getPromptsList } = await import('../dist/core/mcp/prompts.js');
const { getResourcesList } = await import('../dist/core/mcp/resources.js');
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

const byName = (arr, n) => arr.find((x) => x.name === n);
const byUri = (arr, u) => arr.find((x) => x.uri === u);

await test('built-in prompts agent_brief / agent_prompt expose title', async () => {
  const { prompts } = await getPromptsList(ctx);
  assert.equal(byName(prompts, 'agent_brief').title, 'Agent brief');
  assert.equal(byName(prompts, 'agent_prompt').title, 'Agent prompt');
});

await test('custom prompt icons round-trip in prompts/list', async () => {
  const { prompts } = await getPromptsList(ctx);
  const p = byName(prompts, 'with_icon');
  assert.equal(p.title, 'With icon');
  assert.deepEqual(p.icons, [{ src: 'https://example.com/i.png', mimeType: 'image/png', sizes: '48x48' }]);
});

await test('prompt without title/icons stays free of them, no content leaked', async () => {
  const { prompts } = await getPromptsList(ctx);
  const p = byName(prompts, 'plain_prompt');
  assert.equal('title' in p, false);
  assert.equal('icons' in p, false);
  assert.equal('content' in p, false);
});

await test('built-in resources expose title', async () => {
  const { resources } = await getResourcesList(ctx);
  assert.equal(byUri(resources, 'project://version').title, 'Server version');
  assert.equal(byUri(resources, 'doc://readme').title, 'README');
});

await test('built-in text resource gets a computed size (bytes)', async () => {
  const { resources } = await getResourcesList(ctx);
  const v = byUri(resources, 'project://version');
  assert.equal(typeof v.size, 'number');
  assert.ok(v.size > 0);
});

await test('custom resource size / icons round-trip; author size wins', async () => {
  const { resources } = await getResourcesList(ctx);
  const r = byUri(resources, 'cfg://sized');
  assert.equal(r.size, 123); // explicit size preserved, not recomputed
  assert.equal(r.title, 'Sized resource');
  assert.deepEqual(r.icons, [{ src: 'https://example.com/r.svg', mimeType: 'image/svg+xml' }]);
});

await test('resource without new fields: no icons, no content; size computed', async () => {
  const { resources } = await getResourcesList(ctx);
  const r = byUri(resources, 'cfg://plain');
  assert.equal('icons' in r, false);
  assert.equal('content' in r, false);
  assert.equal(r.size, Buffer.byteLength('abc', 'utf-8'));
});

console.log(failed === 0 ? '\nAll prompt/resource metadata tests passed.' : `\n${failed} test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
