import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { IToolInputSchema, IToolProperties } from '../../core/index.js';

/**
 * Template tools configuration for MCP Server
 * Define your tools according to your server's functionality
 *
 * Schemas follow JSON Schema draft 2020-12 (`$schema`) and reject unknown fields
 * (`additionalProperties: false`) — required by standard §9.2.
 */

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

const getGenericInputSchema = (
  queryDescription?: string,
  additionalProperties?: IToolProperties,
): IToolInputSchema => ({
  $schema: JSON_SCHEMA_2020_12,
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: queryDescription || 'Input query or text',
    },
    ...additionalProperties,
  },
  required: ['query'],
  additionalProperties: false,
});

const getSearchInputSchema = (): IToolInputSchema => ({
  $schema: JSON_SCHEMA_2020_12,
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Text to match against the in-memory template example records.',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of results to return (1-100, default: 20)',
      minimum: 1,
      maximum: 100,
    },
    threshold: {
      type: 'number',
      description: 'Minimum similarity threshold (0-1)',
      minimum: 0,
      maximum: 1,
    },
  },
  required: ['query'],
  additionalProperties: false,
});

const exampleSearchOutputSchema = {
  $schema: JSON_SCHEMA_2020_12,
  type: 'object',
  properties: {
    results: {
      type: 'array',
      description: 'Ordered search matches returned for the query.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Stable identifier of the matched example record.' },
          score: { type: 'number', description: 'Match score from zero to one.', minimum: 0, maximum: 1 },
          text: { type: 'string', description: 'Text of the matched example record.' },
        },
        required: ['id', 'score', 'text'],
        additionalProperties: false,
      },
    },
    total: { type: 'integer', description: 'Total number of matches returned.', minimum: 0 },
  },
  required: ['results', 'total'],
  additionalProperties: false,
} as const;

const exampleToolOutputSchema = {
  $schema: JSON_SCHEMA_2020_12,
  type: 'object',
  properties: {
    message: { type: 'string', description: 'Confirmation containing the processed input text.' },
    timestamp: { type: 'string', format: 'date-time', description: 'UTC time when processing completed.' },
  },
  required: ['message', 'timestamp'],
  additionalProperties: false,
} as const;

const exampleLongTaskOutputSchema = {
  $schema: JSON_SCHEMA_2020_12,
  type: 'object',
  properties: {
    message: { type: 'string', description: 'Human-readable completion summary.' },
    steps: { type: 'integer', description: 'Number of processing steps completed.', minimum: 1, maximum: 20 },
    finishedAt: { type: 'string', format: 'date-time', description: 'UTC time when all steps completed.' },
  },
  required: ['message', 'steps', 'finishedAt'],
  additionalProperties: false,
} as const;

// Template tools - customize according to your needs
export const tools: Tool[] = [
  {
    name: 'example_tool',
    title: 'Example: process text',
    description:
      'Processes one text input and returns a confirmation plus completion timestamp. Use for the template smoke ' +
      'flow; replace it with a domain tool in real services. Requires query and does not perform external writes.',
    inputSchema: getGenericInputSchema('Text content to process in the deterministic template smoke flow.'),
    outputSchema: exampleToolOutputSchema as any,
  },
  {
    name: 'example_search',
    title: 'Example: search with filters',
    description:
      'Searches the in-memory template examples and returns ordered matches with scores and a total. Use to model ' +
      'read-only search tools; query is required, while limit and threshold constrain the result set.',
    inputSchema: getSearchInputSchema(),
    outputSchema: exampleSearchOutputSchema as any,
  },
  {
    // Standard §8.7 / §9.1 — example of a long-running tool that opts in to task-augmented
    // execution. With `mcp.tasks.enabled: true`, a client MAY send a `task` param to tools/call:
    // the server returns a taskId immediately, runs this handler in the background (reporting
    // progress and honouring cancellation), and the client polls tasks/get + tasks/result.
    // `taskSupport: 'optional'` keeps the tool callable synchronously too — choose a task when the
    // work can exceed the 30s tool timeout or you want a cancellable, pollable operation.
    name: 'example_long_task',
    title: 'Example: long-running task',
    description:
      'Runs a bounded simulation, emits progress, and returns completed steps with a timestamp. Use task-augmented ' +
      'execution for cancellable work; steps defaults to 5 and is capped at 20. It has no external side effects.',
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      type: 'object',
      properties: {
        steps: {
          type: 'integer',
          description: 'Number of processing steps to simulate (1-20, default 5)',
          minimum: 1,
          maximum: 20,
        },
      },
      required: [],
      additionalProperties: false,
    },
    outputSchema: exampleLongTaskOutputSchema as any,
    execution: { taskSupport: 'optional' },
  } as Tool,
  // TODO: Add your actual tools here
  // {
  //   name: 'your_tool_name',
  //   title: 'Human-readable title shown in UI',
  //   description: 'Description of what your tool does',
  //   inputSchema: getGenericInputSchema('Your query description', {
  //     // additional parameters
  //     param1: {
  //       type: 'string',
  //       description: 'Description of param1',
  //     },
  //   }),
  // },
];

// Helper to get tool by name
export const getToolByName = (name: string): Tool | undefined => {
  return tools.find((tool) => tool.name === name);
};

// Helper to get all tool names
export const getToolNames = (): string[] => {
  return tools.map((tool) => tool.name);
};
