/**
 * Phase 6 / WI-1,3,4 — task lifecycle (standard §8.7, §9.1).
 *
 * With `mcp.tasks.enabled: true` the server advertises the `tasks` capability and serves the
 * lifecycle methods. A task-augmented tools/call returns a taskId immediately with status
 * `working`; polling tasks/get reflects `working → completed`; tasks/result then returns the same
 * result a synchronous call would. tasks/list returns the caller's tasks newest first. WI-3 dispatch
 * rules (`taskSupport` optional/required/forbidden) are checked too.
 *
 * Tasks are enabled via NODE_CONFIG for this process.
 */
process.env.NODE_CONFIG = JSON.stringify({ mcp: { tasks: { enabled: true, pollIntervalMs: 10 } } });

import assert from 'node:assert/strict';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CreateTaskResultSchema,
  GetTaskResultSchema,
  GetTaskPayloadResultSchema,
  ListTasksResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

const { createMcpServer } = await import('../dist/core/mcp/create-mcp-server.js');
const { resetTaskStore } = await import('../dist/core/mcp/task-store.js');

const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function projectData() {
  return {
    agentBrief: 'B',
    agentPrompt: 'P',
    tools: [
      {
        name: 'slow_task',
        description: 'slow',
        inputSchema: {
          $schema: JSON_SCHEMA,
          type: 'object',
          properties: { steps: { type: 'number' } },
          additionalProperties: false,
        },
        execution: { taskSupport: 'optional' },
      },
      {
        name: 'task_required',
        description: 'required',
        inputSchema: { $schema: JSON_SCHEMA, type: 'object', properties: {}, additionalProperties: false },
        execution: { taskSupport: 'required' },
      },
      {
        name: 'sync_only',
        description: 'sync',
        inputSchema: { $schema: JSON_SCHEMA, type: 'object', properties: {}, additionalProperties: false },
      },
    ],
    toolHandler: async (p) => {
      if (p.name === 'slow_task' || p.name === 'task_required') {
        const steps = p.arguments?.steps ?? 3;
        for (let i = 1; i <= steps; i++) {
          if (p.signal?.aborted) {
            throw new Error('aborted');
          }
          await sleep(15);
          p.sendProgress?.(i, steps, `step ${i}`);
        }
        return { content: [{ type: 'text', text: `done ${steps}` }] };
      }
      return { content: [{ type: 'text', text: 'sync' }] };
    },
  };
}

async function connect() {
  resetTaskStore();
  globalThis.__MCP_PROJECT_DATA__ = projectData();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer('http');
  await server.connect(st);
  const client = new Client({ name: 'tasks-life-test', version: '1.0.0' }, { capabilities: { tasks: {} } });
  await client.connect(ct);
  return { server, client };
}

async function waitForStatus(client, taskId, status, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await client.request({ method: 'tasks/get', params: { taskId } }, GetTaskResultSchema);
    if (task.status === status) {
      return task;
    }
    await sleep(10);
  }
  throw new Error(`task ${taskId} did not reach status ${status} in time`);
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

  await test('tasks capability advertised when enabled', () => {
    const caps = client.getServerCapabilities();
    assert.ok(caps.tasks);
    assert.ok(caps.tasks.list);
    assert.ok(caps.tasks.cancel);
    assert.ok(caps.tasks.requests.tools.call);
  });

  let taskId;
  await test('task-augmented tools/call returns taskId + working immediately', async () => {
    const res = await client.request(
      { method: 'tools/call', params: { name: 'slow_task', arguments: { steps: 3 }, task: {} } },
      CreateTaskResultSchema,
    );
    assert.ok(res.task.taskId);
    assert.equal(res.task.status, 'working');
    assert.equal(res.task.pollInterval, 10);
    ({ taskId } = res.task);
  });

  await test('tasks/get reflects working → completed', async () => {
    const done = await waitForStatus(client, taskId, 'completed');
    assert.equal(done.status, 'completed');
  });

  await test('tasks/result returns the same result a sync call would', async () => {
    const payload = await client.request({ method: 'tasks/result', params: { taskId } }, GetTaskPayloadResultSchema);
    assert.equal(payload.content[0].text, 'done 3');
  });

  await test('tasks/list returns the caller task', async () => {
    const list = await client.request({ method: 'tasks/list', params: {} }, ListTasksResultSchema);
    assert.ok(list.tasks.some((t) => t.taskId === taskId));
  });

  await test('unknown taskId → -32002', async () => {
    await assert.rejects(
      () => client.request({ method: 'tasks/get', params: { taskId: 'does-not-exist' } }, GetTaskResultSchema),
      (err) => err.code === -32002,
    );
  });

  // WI-3 dispatch rules.
  await test('task param on a forbidden/sync tool → -32602', async () => {
    await assert.rejects(
      () =>
        client.request(
          { method: 'tools/call', params: { name: 'sync_only', arguments: {}, task: {} } },
          CreateTaskResultSchema,
        ),
      (err) => err.code === -32602,
    );
  });

  await test('no task param on a required tool → -32602', async () => {
    await assert.rejects(
      () =>
        client.request(
          { method: 'tools/call', params: { name: 'task_required', arguments: {} } },
          CreateTaskResultSchema,
        ),
      (err) => err.code === -32602,
    );
  });

  await client.close();
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll tasks-lifecycle tests passed!');
