import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { formatToolResult, IToolHandlerParams, ToolExecutionError, TToolHandlerResponse } from '../../core/index.js';

import { ITemplateTool } from './tool.js';

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/**
 * `example_long_task` — a long-running tool that emits progress and supports cancellation, and opts in
 * to task-augmented execution (standard §8.7 / §9.1). With `mcp.tasks.enabled: true`, a client MAY send
 * a `task` param to tools/call: the server returns a taskId immediately, runs this handler in the
 * background (reporting progress and honouring cancellation), and the client polls tasks/get +
 * tasks/result. `taskSupport: 'optional'` keeps the tool callable synchronously too — choose a task when
 * the work can exceed the 30s tool timeout or you want a cancellable, pollable operation.
 */
const definition: Tool = {
  name: 'example_long_task',
  title: 'Example: long-running task',
  description: `Example long-running tool that emits progress and supports cancellation.
Demonstrates task-augmented execution — call it with a 'task' param to run it as a task.`,
  inputSchema: {
    $schema: JSON_SCHEMA_2020_12,
    type: 'object',
    properties: {
      steps: {
        type: 'number',
        description: 'Number of processing steps to simulate (1-20, default 5)',
        minimum: 1,
        maximum: 20,
      },
    },
    required: [],
    additionalProperties: false,
  },
  execution: { taskSupport: 'optional' },
} as Tool;

/**
 * The same handler runs whether the tool is called synchronously or as a task — the SDK supplies
 * `signal` and `sendProgress` in both cases. As a task, `signal` is flipped by `tasks/cancel` and
 * progress is delivered via `notifications/progress`; synchronously, the 30s tool timeout applies,
 * which is exactly why long work should be invoked as a task.
 */
async function handler(params: IToolHandlerParams): Promise<TToolHandlerResponse> {
  const { arguments: args, signal, sendProgress } = params;
  const steps = Math.min(20, Math.max(1, Number(args?.steps) || 5));

  for (let i = 1; i <= steps; i++) {
    if (signal?.aborted) {
      throw new ToolExecutionError('example_long_task', 'Cancelled by client');
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    sendProgress?.(i, steps, `Completed step ${i} of ${steps}`);
  }

  return formatToolResult({
    message: `Completed ${steps} steps`,
    steps,
    finishedAt: new Date().toISOString(),
  });
}

export const exampleLongTask: ITemplateTool = { definition, handler };
