/**
 * Standard v2.0 Appendix B — insufficient_scope is reported as -32000 Server error
 * (with data.reason = 'insufficient_scope'); -32004 is reserved for Timeout only.
 *
 * Uses the SDK in-memory transport — no HTTP spawn — with an injected project-data global.
 */
import assert from 'node:assert/strict';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ResultSchema } from '@modelcontextprotocol/sdk/types.js';

const { createMcpServer } = await import('../dist/core/mcp/create-mcp-server.js');

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

globalThis.__MCP_PROJECT_DATA__ = {
  tools: [
    {
      name: 'scoped_tool',
      description: 'Requires a scope the caller does not have',
      inputSchema: { type: 'object', additionalProperties: false },
      requiredScopes: ['mcp:admin'],
    },
  ],
  toolHandler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  agentBrief: '',
  agentPrompt: '',
};

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createMcpServer('http');
await server.connect(serverTransport);
const client = new Client({ name: 'scope-test', version: '1.0.0' }, { capabilities: {} });
await client.connect(clientTransport);

await test('tools/call without required scope → -32000 with data.reason=insufficient_scope', async () => {
  await assert.rejects(
    () => client.request({ method: 'tools/call', params: { name: 'scoped_tool', arguments: {} } }, ResultSchema),
    (err) => {
      assert.equal(err.code, -32000, `expected -32000, got ${err.code}`);
      assert.equal(err.data?.reason, 'insufficient_scope');
      return true;
    },
  );
});

await client.close();
await server.close();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll scope-error tests passed');
