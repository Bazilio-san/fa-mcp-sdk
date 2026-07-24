import { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  formatToolResult,
  hostSupportsMcpApps,
  IToolHandlerParams,
  maskSensitive,
  MCP_APPS_RESOURCE_MIME_TYPE,
  ToolExecutionError,
  TToolHandlerResponse,
} from '../../core/index.js';

import { ITemplateTool } from './tool.js';
import { renderWidgetDocument } from './widget-document.js';

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/**
 * `example_tool` — processes a text input and returns the result. When the connected host supports
 * MCP Apps (Agent Tester with the "Apps" toggle on) it also returns an interactive widget visualizing
 * the result; otherwise it returns the plain text/JSON result, so nothing changes for non-UI clients.
 * Replace this with one of your actual tools (keep the "one tool = one file" layout).
 */
const definition: Tool = {
  name: 'example_tool',
  title: 'Example: process text',
  description: `Example tool that processes text input. 
When the host supports MCP Apps (Agent Tester with the "Apps" toggle on), 
it also returns an interactive widget visualizing the result. 
Replace with your actual tools.`,
  inputSchema: {
    $schema: JSON_SCHEMA_2020_12,
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text to process' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

async function handler(params: IToolHandlerParams): Promise<TToolHandlerResponse> {
  const query = params.arguments?.query;

  if (!query) {
    throw new ToolExecutionError('example_tool', 'Query parameter is required');
  }

  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 100));

  const result = {
    message: `Processed query: ${query}`,
    timestamp: new Date().toISOString(),
  };

  // Standard §12.2 — masking personal / sensitive data is the server's responsibility. For domains
  // with such data, run the result through `maskSensitive` before returning. It is opt-in: the SDK
  // never masks automatically. Rules are explicit (field names + regex), nothing is guessed.
  // Example (no-op here, since the sample result has no sensitive fields):
  const safeResult = maskSensitive(result, {
    fieldNames: ['password', 'token', 'ssn'],
    patterns: [/\b\d{13,19}\b/g], // card-like number sequences
    replacement: '***',
  });

  // MCP Apps path: the host can render UI resources → return the text result AND an embedded widget.
  // The text block keeps the model (and non-UI fallback) fully informed; the resource block carries
  // the HTML the host shows in an iframe. `hostSupportsMcpApps` returns false when the host did not
  // advertise the extension, so this branch is skipped and we return plain text below.
  if (hostSupportsMcpApps(params.clientCapabilities)) {
    return {
      content: [
        { type: 'text', text: JSON.stringify(safeResult, null, 2) },
        {
          type: 'resource',
          resource: {
            uri: 'ui://example/process-text.html',
            mimeType: MCP_APPS_RESOURCE_MIME_TYPE,
            text: buildWidgetHtml(String(query), safeResult),
          },
        },
      ],
      // Structured clients (answerAs: 'structuredContent') still receive the JSON payload.
      structuredContent: safeResult,
    } as unknown as TToolHandlerResponse;
  }

  return formatToolResult(safeResult);
}

/** HTML for the `example_tool` widget — a card with the processed query, result and timestamp. */
function buildWidgetHtml(query: string, data: { message: string; timestamp: string }): string {
  return renderWidgetDocument(
    'Text processing',
    [
      { k: 'Query', v: query, mono: true },
      { k: 'Result', v: data.message },
      { k: 'Time', v: new Date(data.timestamp).toLocaleString() },
    ],
    'MCP App example: the widget of the example_tool test tool.',
  );
}

export const exampleTool: ITemplateTool = { definition, handler };
