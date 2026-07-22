/** Tool-level `isError:true` must be an error in SDK traces and metrics for sync and task calls. */
process.env.NODE_CONFIG = JSON.stringify({
  mcp: { tasks: { enabled: true, pollIntervalMs: 10 } },
  webServer: { metrics: { includeProcessMetrics: false } },
});

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CreateTaskResultSchema,
  GetTaskPayloadResultSchema,
  GetTaskResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

const { createMcpServer } = await import('../dist/core/mcp/create-mcp-server.js');
const { configureDebugSink } = await import('../dist/core/mcp/debug-trace.js');
const { getMetricsRegistry, initMetrics } = await import('../dist/core/metrics/metrics.js');
const { resetTaskStore } = await import('../dist/core/mcp/task-store.js');
const { wrapProjectDataWithDebug } = await import('../dist/core/mcp/wrap-project-data-with-debug.js');

const traceDir = mkdtempSync(join(tmpdir(), 'fa-mcp-tool-error-outcome-'));
const traceFile = join(traceDir, 'operations.jsonl');
const TOOL_ARGUMENT_SECRET = 'tool-argument-value-must-not-enter-logs';
const TOOL_RESULT_SECRET = 'tool-result-value-must-not-enter-logs';
const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';

const tool = (name, taskSupport) => ({
  name,
  description: `Returns a tool-level error from ${name}.`,
  inputSchema: {
    $schema: JSON_SCHEMA,
    type: 'object',
    properties: { secret: { type: 'string' } },
    additionalProperties: false,
  },
  execution: { taskSupport },
});

const projectData = wrapProjectDataWithDebug({
  agentBrief: 'B',
  agentPrompt: 'P',
  tools: [tool('sync_error', 'optional'), tool('task_error', 'optional')],
  toolHandler: async ({ name }) => ({
    isError: true,
    content: [{ type: 'text', text: `${TOOL_RESULT_SECRET}:${name}` }],
  }),
});

function readTraceEvents() {
  if (!existsSync(traceFile)) {
    return [];
  }
  return readFileSync(traceFile, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForTask(client, taskId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const task = await client.request({ method: 'tasks/get', params: { taskId } }, GetTaskResultSchema);
    if (task.status === 'completed') {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Task ${taskId} did not complete.`);
}

async function waitForEvidence(registry) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const events = readTraceEvents();
    const metrics = await registry.metrics();
    const hasTrace = ['sync_error', 'task_error'].every((name) =>
      events.some((event) => event.ch === 'mcp:tool' && event.kind === 'res' && event.name === name),
    );
    const hasMetrics = ['sync_error', 'task_error'].every((name) =>
      metrics.includes(`mcp_tool_calls_total{tool="${name}",status="error"} 1`),
    );
    if (hasTrace && hasMetrics) {
      return { events, metrics };
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { events: readTraceEvents(), metrics: await registry.metrics() };
}

resetTaskStore();
const registry = getMetricsRegistry();
initMetrics();
globalThis.__MCP_PROJECT_DATA__ = projectData;
configureDebugSink(traceFile);

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createMcpServer('http');
await server.connect(serverTransport);
const client = new Client({ name: 'tool-error-outcome-test', version: '1.0.0' }, { capabilities: { tasks: {} } });
await client.connect(clientTransport);

try {
  const syncResult = await client.callTool({
    name: 'sync_error',
    arguments: { secret: TOOL_ARGUMENT_SECRET },
  });
  assert.equal(syncResult.isError, true);

  const started = await client.request(
    {
      method: 'tools/call',
      params: { name: 'task_error', arguments: { secret: TOOL_ARGUMENT_SECRET }, task: {} },
    },
    CreateTaskResultSchema,
  );
  await waitForTask(client, started.task.taskId);
  const taskResult = await client.request(
    { method: 'tasks/result', params: { taskId: started.task.taskId } },
    GetTaskPayloadResultSchema,
  );
  assert.equal(taskResult.isError, true);

  const { events, metrics } = await waitForEvidence(registry);
  for (const name of ['sync_error', 'task_error']) {
    const completion = events.find((event) => event.ch === 'mcp:tool' && event.kind === 'res' && event.name === name);
    assert.ok(completion, `${name} completion trace was not written by the SDK wrapper`);
    assert.equal(completion.status, 'error');
    assert.equal(completion.ok, false);
    assert.equal(completion.result?.isError, true);
    assert.match(metrics, new RegExp(`mcp_tool_calls_total\\{tool="${name}",status="error"\\} 1`));
    assert.doesNotMatch(metrics, new RegExp(`mcp_tool_calls_total\\{tool="${name}",status="ok"\\}`));
  }

  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, new RegExp(`${TOOL_ARGUMENT_SECRET}|${TOOL_RESULT_SECRET}`));
  console.log('SDK wrapper traces and metrics classify sync/task tool-level errors correctly.');
} finally {
  configureDebugSink(null);
  await client.close();
  await server.close();
  resetTaskStore();
  delete globalThis.__MCP_PROJECT_DATA__;
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(traceDir, { recursive: true, force: true });
}
