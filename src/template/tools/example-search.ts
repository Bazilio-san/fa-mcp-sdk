import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { formatToolResult, IToolHandlerParams, ToolExecutionError, TToolHandlerResponse } from '../../core/index.js';

import { ITemplateTool } from './tool.js';

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/**
 * `example_search` — a search tool with pagination and filtering, and a declared `outputSchema` so the
 * SDK validates the structured result. The handler returns illustrative sample matches; replace it
 * with a real search (vector store, database, upstream API) against your data.
 */
const definition: Tool = {
  name: 'example_search',
  title: 'Example: search with filters',
  description: 'Example search tool with pagination and filtering. Template for search-based tools.',
  inputSchema: {
    $schema: JSON_SCHEMA_2020_12,
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      limit: {
        type: 'number',
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
  },
  outputSchema: {
    $schema: JSON_SCHEMA_2020_12,
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            score: { type: 'number' },
            text: { type: 'string' },
          },
          required: ['id'],
          additionalProperties: true,
        },
      },
      total: { type: 'number' },
    },
    required: ['results'],
    additionalProperties: true,
  },
} as Tool;

function handler(params: IToolHandlerParams): TToolHandlerResponse {
  const { query, limit, threshold } = params.arguments || {};

  if (!query) {
    throw new ToolExecutionError('example_search', 'Query parameter is required');
  }

  const max = Math.min(100, Math.max(1, Number(limit) || 20));
  const minScore = Number.isFinite(Number(threshold)) ? Number(threshold) : 0;

  // Illustrative sample matches — replace with a real search over your data.
  const results = Array.from({ length: Math.min(3, max) }, (_unused, i) => ({
    id: `doc-${i + 1}`,
    score: Number((1 - i * 0.15).toFixed(2)),
    text: `Sample match ${i + 1} for "${query}"`,
  })).filter((r) => r.score >= minScore);

  return formatToolResult({ results, total: results.length });
}

export const exampleSearch: ITemplateTool = { definition, handler };
