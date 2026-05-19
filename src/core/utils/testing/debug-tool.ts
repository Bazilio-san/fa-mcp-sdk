/**
 * Universal `debug-tool` for integration testing of MCP clients (Agent Tester,
 * custom hosts, CI smoke tests).
 *
 * One parameterised tool that can produce **any** variation of
 * `CallToolResult`: every content-block type from the MCP spec, single vs.
 * multiple blocks, `structuredContent` / `_meta` toggles, `isError: true`,
 * delay simulation, and a `largeInput` knob for streaming / truncate tests.
 *
 * Activated together with the other built-ins via
 * `appConfig.mcp.debug.builtinTools = true`. Test code can also import the
 * tool descriptor + handler directly to spin up a stand-alone server.
 *
 * The constants for an image / audio block (`BLUE_PNG_1X1`, `SILENT_WAV`)
 * are kept private to this file — never exported.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { IToolHandlerParams, TToolHandlerResponse } from '../../_types_/types.js';

export const DEBUG_TOOL_NAME = 'debug-tool';

// Minimal 1×1 blue PNG (base64). Private — keeps the public surface clean.
const BLUE_PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';

// Minimal silent WAV (base64) — 44 byte header + 1 sample.
const SILENT_WAV = 'UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==';

let callCounter = 0;

type ContentType = 'text' | 'image' | 'audio' | 'resource' | 'resourceLink' | 'mixed';

interface DebugToolArgs {
  contentType?: ContentType;
  multipleBlocks?: boolean;
  includeStructuredContent?: boolean;
  includeMeta?: boolean;
  largeInput?: string;
  simulateError?: boolean;
  delayMs?: number;
}

/** `Tool` descriptor for the universal debug-tool. */
export const DEBUG_TOOL: Tool = {
  name: DEBUG_TOOL_NAME,
  title: 'Debug tool',
  description:
    'App-only test helper. Produces any variation of CallToolResult (text/image/audio/resource/' +
    'resourceLink/mixed, single or multi-block, isError, delays, large payload) so MCP host tests ' +
    'can exercise every code path without standing up a bespoke fake server. Hidden from the LLM ' +
    'via _meta.ui.visibility=["app"].',
  inputSchema: {
    type: 'object',
    properties: {
      contentType: {
        type: 'string',
        enum: ['text', 'image', 'audio', 'resource', 'resourceLink', 'mixed'],
        description: 'Which content-block type to emit. "mixed" returns one of each (ignores multipleBlocks).',
      },
      multipleBlocks: {
        type: 'boolean',
        description: 'When true, emit 3 blocks of the chosen type; otherwise emit 1. Default: true.',
      },
      includeStructuredContent: {
        type: 'boolean',
        description: 'Include result.structuredContent with config/timestamp/counter. Default: true.',
      },
      includeMeta: {
        type: 'boolean',
        description: 'Include result._meta with diagnostic fields. Default: true.',
      },
      largeInput: {
        type: 'string',
        description: 'Optional large payload — its length is echoed back in structuredContent.largeInputLength.',
      },
      simulateError: {
        type: 'boolean',
        description: 'When true, set result.isError = true (the call still resolves). Default: false.',
      },
      delayMs: {
        type: 'number',
        description: 'Optional artificial delay (ms) before responding — for timeout / loading-state tests.',
        minimum: 0,
      },
    },
  },
  _meta: { ui: { visibility: ['app'] } },
};

function buildContent(args: DebugToolArgs): any[] {
  const contentType: ContentType = args.contentType ?? 'text';
  const multiple = args.multipleBlocks !== false;

  if (contentType === 'mixed') {
    return [
      { type: 'text', text: 'Mixed content: text block' },
      { type: 'image', data: BLUE_PNG_1X1, mimeType: 'image/png' },
      { type: 'audio', data: SILENT_WAV, mimeType: 'audio/wav' },
    ];
  }

  const count = multiple ? 3 : 1;
  const blocks: any[] = [];
  for (let i = 0; i < count; i++) {
    const suffix = multiple ? ` #${i + 1}` : '';
    switch (contentType) {
      case 'text':
        blocks.push({ type: 'text', text: `Debug text content${suffix}` });
        break;
      case 'image':
        blocks.push({ type: 'image', data: BLUE_PNG_1X1, mimeType: 'image/png' });
        break;
      case 'audio':
        blocks.push({ type: 'audio', data: SILENT_WAV, mimeType: 'audio/wav' });
        break;
      case 'resource':
        blocks.push({
          type: 'resource',
          resource: {
            uri: `debug://embedded-resource${suffix.replace(/\s/g, '-')}`,
            text: `Embedded resource content${suffix}`,
            mimeType: 'text/plain',
          },
        });
        break;
      case 'resourceLink':
        blocks.push({
          type: 'resource_link',
          uri: `debug://linked-resource${suffix.replace(/\s/g, '-')}`,
          name: `Linked Resource${suffix}`,
          mimeType: 'text/plain',
        });
        break;
    }
  }
  return blocks;
}

/** Execute the debug-tool. Returns a `CallToolResult`-shaped response. */
export async function handleDebugTool(params: IToolHandlerParams): Promise<TToolHandlerResponse> {
  const args = (params.arguments ?? {}) as DebugToolArgs;

  if (typeof args.delayMs === 'number' && args.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, args.delayMs));
  }

  const content = buildContent(args);
  const result: any = { content };

  if (args.includeStructuredContent !== false) {
    result.structuredContent = {
      config: args,
      timestamp: new Date().toISOString(),
      counter: ++callCounter,
      ...(args.largeInput ? { largeInputLength: args.largeInput.length } : {}),
    };
  }

  if (args.includeMeta !== false) {
    result._meta = {
      debugInfo: {
        processedAt: Date.now(),
      },
    };
  }

  if (args.simulateError) {
    result.isError = true;
  }

  return result as TToolHandlerResponse;
}

/**
 * Register the debug-tool against a `McpServer` from
 * `@modelcontextprotocol/sdk/server/mcp.js`. Use this for stand-alone test
 * servers that do not go through `initMcpServer()`.
 *
 * The signature deliberately uses a structural type so the SDK does not take
 * a hard dependency on the high-level `McpServer` class.
 */
export function registerDebugTool(server: {
  registerTool: (name: string, def: any, handler: (args: any) => unknown) => void;
}): void {
  server.registerTool(
    DEBUG_TOOL_NAME,
    {
      title: DEBUG_TOOL.title,
      description: DEBUG_TOOL.description,
      inputSchema: DEBUG_TOOL.inputSchema,
      _meta: DEBUG_TOOL._meta,
    },
    async (args: DebugToolArgs) =>
      handleDebugTool({
        name: DEBUG_TOOL_NAME,
        arguments: args,
        transport: 'stdio',
      }),
  );
}
