/** Tool traces describe the post-validation/post-limit/post-timeout wire outcome without PII. */
process.env.NODE_CONFIG = JSON.stringify({
  mcp: {
    limits: { maxToolResultBytes: 768, toolTimeoutMs: 40 },
    tasks: { enabled: true, pollIntervalMs: 5 },
  },
  webServer: { metrics: { includeProcessMetrics: false } },
});

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CreateTaskResultSchema, GetTaskResultSchema } from '@modelcontextprotocol/sdk/types.js';

const { createMcpServer } = await import('../dist/core/mcp/create-mcp-server.js');
const { configureDebugSink } = await import('../dist/core/mcp/debug-trace.js');
const { resetTaskStore } = await import('../dist/core/mcp/task-store.js');

const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const ARGUMENT_KEY = 'privateArgumentEmail';
const ARGUMENT_VALUE = 'employee.private@example.test';
const OUTPUT_KEY = 'privateOutputEmail';
const OUTPUT_VALUE = 'output.private@example.test';
const traceDir = mkdtempSync(join(tmpdir(), 'fa-mcp-final-tool-trace-'));
const traceFile = join(traceDir, 'operations.jsonl');
let releaseTaskHandler;
const taskGate = new Promise((resolve) => {
  releaseTaskHandler = resolve;
});

const inputSchema = {
  $schema: JSON_SCHEMA,
  type: 'object',
  properties: { [ARGUMENT_KEY]: { type: 'string' } },
  required: [ARGUMENT_KEY],
  additionalProperties: false,
};

globalThis.__MCP_PROJECT_DATA__ = {
  agentBrief: 'B',
  agentPrompt: 'P',
  tools: [
    {
      name: 'oversized_write',
      description: 'Return an oversized write result.',
      inputSchema,
      outputSchema: {
        $schema: JSON_SCHEMA,
        type: 'object',
        properties: { [OUTPUT_KEY]: { type: 'string' } },
        required: [OUTPUT_KEY],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: 'invalid_output',
      description: 'Return output that violates the schema.',
      inputSchema,
      outputSchema: {
        $schema: JSON_SCHEMA,
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
        additionalProperties: false,
      },
    },
    {
      name: 'timeout_sync',
      description: 'Ignore cancellation until after the timeout.',
      inputSchema,
    },
    {
      name: 'timeout_task',
      description: 'Ignore cancellation in a task until explicitly released.',
      inputSchema,
      execution: { taskSupport: 'required' },
    },
  ],
  toolHandler: async ({ name }) => {
    if (name === 'oversized_write') {
      return {
        content: [{ type: 'text', text: `private-result:${OUTPUT_VALUE}` }],
        structuredContent: { [OUTPUT_KEY]: OUTPUT_VALUE.repeat(1_000) },
      };
    }
    if (name === 'invalid_output') {
      return { structuredContent: { value: OUTPUT_VALUE } };
    }
    if (name === 'timeout_task') {
      await taskGate;
      return { content: [{ type: 'text', text: OUTPUT_VALUE }] };
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { content: [{ type: 'text', text: OUTPUT_VALUE }] };
  },
};

function readEvents() {
  if (!existsSync(traceFile)) {
    return [];
  }
  return readFileSync(traceFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForTask(client, taskId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await client.request({ method: 'tasks/get', params: { taskId } }, GetTaskResultSchema);
    if (task.status === 'failed') {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Task ${taskId} did not fail after the configured tool timeout.`);
}

async function waitForCompletions(names) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const events = readEvents();
    if (
      names.every((name) =>
        events.some((event) => event.ch === 'mcp:tool' && event.name === name && ['res', 'err'].includes(event.kind)),
      )
    ) {
      return events;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return readEvents();
}

resetTaskStore();
configureDebugSink(traceFile);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createMcpServer('http');
await server.connect(serverTransport);
const client = new Client({ name: 'tool-final-outcome-trace-test', version: '1.0.0' }, { capabilities: { tasks: {} } });
await client.connect(clientTransport);

try {
  const args = { [ARGUMENT_KEY]: ARGUMENT_VALUE };
  const oversized = await client.callTool({ name: 'oversized_write', arguments: args });
  assert.equal(oversized.isError, true);
  assert.equal(oversized._meta?.['fa-mcp-sdk/result-limit']?.sideEffectState, 'completed');

  await assert.rejects(
    () => client.callTool({ name: 'invalid_output', arguments: args }),
    (error) => error.code === -32603,
  );
  await assert.rejects(
    () => client.callTool({ name: 'timeout_sync', arguments: args }),
    (error) => error.code === -32004,
  );

  const started = await client.request(
    { method: 'tools/call', params: { name: 'timeout_task', arguments: args, task: {} } },
    CreateTaskResultSchema,
  );
  const failedTask = await waitForTask(client, started.task.taskId);
  assert.equal(failedTask.statusMessage, 'Operation timed out');

  let events = await waitForCompletions(['oversized_write', 'invalid_output', 'timeout_sync', 'timeout_task']);
  await new Promise((resolve) => setTimeout(resolve, 150));
  events = readEvents();

  const oversizedTrace = events.find(
    (event) => event.ch === 'mcp:tool' && event.name === 'oversized_write' && event.kind === 'res',
  );
  assert.ok(oversizedTrace);
  assert.equal(oversizedTrace.status, 'error');
  assert.equal(oversizedTrace.result?.isError, true);
  assert.equal(oversizedTrace.result?.hasStructuredContent, false);

  for (const name of ['invalid_output', 'timeout_sync', 'timeout_task']) {
    const completions = events.filter(
      (event) => event.ch === 'mcp:tool' && event.name === name && ['res', 'err'].includes(event.kind),
    );
    assert.equal(completions.length, 1, `${name} must have exactly one final completion trace`);
    assert.equal(completions[0].kind, 'err');
    assert.equal(completions[0].status, 'error');
  }

  const serialized = JSON.stringify(events);
  for (const secret of [ARGUMENT_KEY, ARGUMENT_VALUE, OUTPUT_KEY, OUTPUT_VALUE, 'private-result']) {
    assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  console.log('Tool traces reflect final wire outcomes, including sync/task timeouts, without argument/result PII.');
} finally {
  releaseTaskHandler();
  configureDebugSink(null);
  await client.close();
  await server.close();
  resetTaskStore();
  delete globalThis.__MCP_PROJECT_DATA__;
  await new Promise((resolve) => setTimeout(resolve, 30));
  rmSync(traceDir, { recursive: true, force: true });
}
