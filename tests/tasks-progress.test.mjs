/**
 * Phase 6 / WI-5 — long-running task progress + status notifications (standard §8.6, §8.7).
 *
 * A task-augmented tools/call carrying `_meta.progressToken` delivers progress via
 * `notifications/progress` (with the supplied token) while it runs, and emits a
 * `notifications/tasks/status` with status `completed` when it finishes.
 *
 * Tasks are enabled via NODE_CONFIG for this process.
 */
process.env.NODE_CONFIG = JSON.stringify({
  mcp: { tasks: { enabled: true, pollIntervalMs: 10 }, progress: { throttleMs: 0 } },
});

import assert from 'node:assert/strict';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CreateTaskResultSchema,
  ProgressNotificationSchema,
  TaskStatusNotificationSchema,
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
        inputSchema: { $schema: JSON_SCHEMA, type: 'object', properties: {}, additionalProperties: false },
        execution: { taskSupport: 'optional' },
      },
    ],
    toolHandler: async (p) => {
      for (let i = 1; i <= 4; i++) {
        await sleep(15);
        p.sendProgress?.(i, 4, `step ${i}`);
      }
      return { content: [{ type: 'text', text: 'done' }] };
    },
  };
}

async function connect(onProgress, onStatus) {
  resetTaskStore();
  globalThis.__MCP_PROJECT_DATA__ = projectData();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer('http');
  await server.connect(st);
  const client = new Client({ name: 'tasks-progress-test', version: '1.0.0' }, { capabilities: { tasks: {} } });
  await client.connect(ct);
  // Override the SDK's built-in progress router so we see every progress notification by token.
  client.setNotificationHandler(ProgressNotificationSchema, (n) => onProgress(n.params));
  client.setNotificationHandler(TaskStatusNotificationSchema, (n) => onStatus(n.params));
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
  const progress = [];
  const statuses = [];
  const { server, client } = await connect(
    (p) => progress.push(p),
    (s) => statuses.push(s),
  );

  const created = await client.request(
    { method: 'tools/call', params: { name: 'slow_task', arguments: {}, task: {}, _meta: { progressToken: 'pt1' } } },
    CreateTaskResultSchema,
  );
  const { taskId } = created.task;

  // Wait for the background task to finish + notifications to flush.
  await sleep(200);

  await test('progress notifications delivered with the supplied token', () => {
    const mine = progress.filter((p) => p.progressToken === 'pt1');
    assert.ok(mine.length >= 1, `expected progress for pt1, got ${progress.length} total`);
    assert.ok(mine.every((p) => typeof p.progress === 'number'));
  });

  await test('a tasks/status completed notification was emitted for the task', () => {
    assert.ok(statuses.some((s) => s.taskId === taskId && s.status === 'completed'));
  });

  await client.close();
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll tasks-progress tests passed!');
