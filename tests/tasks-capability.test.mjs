/**
 * Phase 6 / WI-1 — `tasks` capability is opt-in (standard §8.7).
 *
 * With `mcp.tasks.enabled` off (the default — this file sets no NODE_CONFIG), the server MUST NOT
 * advertise `capabilities.tasks`, and the task lifecycle methods MUST return -32601 (method not
 * found). The enabled side is exercised by tasks-lifecycle.test.mjs.
 *
 * Uses the SDK in-memory transport — no HTTP spawn.
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
  // Declare the client-side tasks capability so the SDK lets us send tasks/* requests at all —
  // the point of the test is the SERVER's -32601, not a client-side guard.
  const client = new Client({ name: 'tasks-cap-test', version: '1.0.0' }, { capabilities: { tasks: {} } });
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

const baseData = { tools: [], toolHandler: async () => ({ content: [] }), agentBrief: 'B', agentPrompt: 'P' };

{
  const { server, client } = await connect({ ...baseData });
  const caps = client.getServerCapabilities();

  await test('tasks capability NOT advertised by default', () => {
    assert.equal(caps.tasks, undefined);
  });

  for (const method of ['tasks/list', 'tasks/get', 'tasks/result', 'tasks/cancel']) {
    await test(`${method} → -32601 when tasks disabled`, async () => {
      await assert.rejects(
        () => client.request({ method, params: { taskId: 'x' } }, ResultSchema),
        (err) => err.code === -32601,
      );
    });
  }

  await client.close();
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll tasks-capability tests passed!');
