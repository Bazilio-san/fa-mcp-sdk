/**
 * Phase 5 / WI-1 — conditional capability advertisement (standard §8.2).
 *
 * A server without prompts must NOT advertise `capabilities.prompts`, and prompts/list must
 * return -32601. A server with prompts advertises the capability and serves the list. `tools` and
 * `resources` are always advertised (built-in resources exist in every configuration).
 *
 * Uses the SDK in-memory transport — no HTTP spawn — with an injected project-data global.
 */
import assert from 'node:assert/strict';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ResultSchema } from '@modelcontextprotocol/sdk/types.js';

const { createMcpServer } = await import('../dist/core/mcp/create-mcp-server.js');

async function connect(projectData) {
  globalThis.__MCP_PROJECT_DATA__ = projectData;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer('http');
  await server.connect(serverTransport);
  const client = new Client({ name: 'caps-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { server, client };
}

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

const baseData = { tools: [], toolHandler: async () => ({ content: [] }) };

// --- no prompts ---
{
  const { server, client } = await connect({ ...baseData, agentBrief: '', agentPrompt: '' });
  const caps = client.getServerCapabilities();

  await test('server without prompts does NOT advertise capabilities.prompts', () => {
    assert.equal(caps.prompts, undefined);
  });
  await test('tools and resources are always advertised', () => {
    assert.ok(caps.tools);
    assert.ok(caps.resources);
  });
  await test('completions absent by default', () => {
    assert.equal(caps.completions, undefined);
  });
  await test('prompts/list → -32601 when no prompts', async () => {
    await assert.rejects(
      () => client.request({ method: 'prompts/list', params: {} }, ResultSchema),
      (err) => err.code === -32601,
    );
  });

  await client.close();
  await server.close();
}

// --- with prompts ---
{
  const { server, client } = await connect({ ...baseData, agentBrief: 'Brief', agentPrompt: 'Prompt' });
  const caps = client.getServerCapabilities();

  await test('server with prompts advertises capabilities.prompts', () => {
    assert.ok(caps.prompts);
  });
  await test('prompts/list serves agent_brief and agent_prompt', async () => {
    const list = await client.listPrompts();
    const names = list.prompts.map((p) => p.name);
    assert.ok(names.includes('agent_brief'));
    assert.ok(names.includes('agent_prompt'));
  });

  await client.close();
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll capabilities tests passed!');
