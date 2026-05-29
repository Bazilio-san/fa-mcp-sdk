/**
 * Phase 6 / WI-4,5 — tasks/cancel aborts the running handler (standard §8.5, §8.7).
 *
 * Cancelling a `working` task aborts the AbortController passed to the tool handler (the handler
 * observes `signal.aborted`), transitions the task to `cancelled`, and is idempotent on an
 * already-finished task.
 *
 * Tasks are enabled via NODE_CONFIG for this process.
 */
process.env.NODE_CONFIG = JSON.stringify({ mcp: { tasks: { enabled: true, pollIntervalMs: 10 } } });

import assert from 'node:assert/strict';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CreateTaskResultSchema,
  CancelTaskResultSchema,
  GetTaskResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

const { createMcpServer } = await import('../dist/core/mcp/create-mcp-server.js');
const { resetTaskStore } = await import('../dist/core/mcp/task-store.js');

const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sawAbort = false;

function projectData() {
  return {
    agentBrief: 'B',
    agentPrompt: 'P',
    tools: [
      {
        name: 'slow_task',
        description: 'slow',
        inputSchema: { $schema: JSON_SCHEMA, type: 'object', properties: {}, additionalProperties: false },
        execution: { taskSupport: 'optional' },
      },
    ],
    toolHandler: async (p) => {
      for (let i = 1; i <= 50; i++) {
        if (p.signal?.aborted) {
          sawAbort = true;
          throw new Error('aborted');
        }
        await sleep(20);
        p.sendProgress?.(i, 50);
      }
      return { content: [{ type: 'text', text: 'done' }] };
    },
  };
}

async function connect() {
  resetTaskStore();
  globalThis.__MCP_PROJECT_DATA__ = projectData();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer('http');
  await server.connect(st);
  const client = new Client({ name: 'tasks-cancel-test', version: '1.0.0' }, { capabilities: { tasks: {} } });
  await client.connect(ct);
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

{
  const { server, client } = await connect();

  const created = await client.request(
    { method: 'tools/call', params: { name: 'slow_task', arguments: {}, task: {} } },
    CreateTaskResultSchema,
  );
  const { taskId } = created.task;
  await sleep(40); // let the handler get into its loop

  await test('tasks/cancel transitions the task to cancelled', async () => {
    const res = await client.request({ method: 'tasks/cancel', params: { taskId } }, CancelTaskResultSchema);
    assert.equal(res.status, 'cancelled');
  });

  await test('handler observed signal.aborted', async () => {
    await sleep(40);
    assert.equal(sawAbort, true);
  });

  await test('tasks/get stays cancelled (not overwritten by failed)', async () => {
    await sleep(40);
    const task = await client.request({ method: 'tasks/get', params: { taskId } }, GetTaskResultSchema);
    assert.equal(task.status, 'cancelled');
  });

  await test('cancel is idempotent on a finished task', async () => {
    const res = await client.request({ method: 'tasks/cancel', params: { taskId } }, CancelTaskResultSchema);
    assert.equal(res.status, 'cancelled');
  });

  await client.close();
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll tasks-cancel tests passed!');
