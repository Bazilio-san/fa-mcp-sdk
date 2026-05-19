/**
 * Built-in MCP tools for widget logging / state refresh — activated by
 * `appConfig.mcp.debug.builtinTools = true`.
 *
 * All built-in tools are marked `_meta.ui.visibility: ['app']` so MCP App
 * hosts hide them from the LLM. They are only invoked from widgets via
 * `app.callServerTool(...)` or from test clients that explicitly call them.
 *
 * Two tools are registered here; the universal `debug-tool` (stage 13) lives
 * in {@link ../utils/testing/debug-tool.ts} and is wired through the same
 * flag from `init-mcp-server.ts`.
 *
 * - **mcp-debug-log**     — widget pushes a structured event into the same
 *                            channel as `DEBUG=mcp:*` (via {@link emitTrace}).
 *                            Frees widget code from owning a logger / network
 *                            client / JWT.
 * - **mcp-debug-refresh** — widget reads back lightweight server state
 *                            (timestamp + monotonically-increasing counter)
 *                            without involving the LLM. Useful for polling /
 *                            heartbeat scenarios in widgets.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { IToolHandlerParams, TToolHandlerResponse } from '../_types_/types.js';

import { emitTrace } from './debug-trace.js';

let refreshCounter = 0;

export const MCP_DEBUG_LOG_TOOL_NAME = 'mcp-debug-log';
export const MCP_DEBUG_REFRESH_TOOL_NAME = 'mcp-debug-refresh';

/** Names of the two tools registered by this module. */
export const BUILTIN_MCP_DEBUG_TOOL_NAMES = [MCP_DEBUG_LOG_TOOL_NAME, MCP_DEBUG_REFRESH_TOOL_NAME] as const;

/**
 * `Tool` descriptors for the built-in debug tools. Both carry
 * `_meta.ui.visibility: ['app']` so MCP App hosts hide them from the model.
 */
export const BUILTIN_MCP_DEBUG_TOOLS: Tool[] = [
  {
    name: MCP_DEBUG_LOG_TOOL_NAME,
    title: 'MCP debug log',
    description:
      'App-only tool. Widgets call this to push a structured event into the server-side mcp:* debug stream. ' +
      'Hidden from the LLM via _meta.ui.visibility=["app"].',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Event category, e.g. "render-error", "user-click", "view-state".',
        },
        payload: {
          description: 'Arbitrary event payload. Any JSON value (object, string, number, array, null).',
        },
      },
      required: ['type'],
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: MCP_DEBUG_REFRESH_TOOL_NAME,
    title: 'MCP debug refresh',
    description:
      'App-only tool. Widgets call this to fetch lightweight server state (timestamp + call counter) ' +
      'without involving the LLM. Hidden from the LLM via _meta.ui.visibility=["app"].',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    _meta: { ui: { visibility: ['app'] } },
  },
];

/** True when `name` belongs to one of the built-in debug tools. */
export function isBuiltinDebugTool(name: string): boolean {
  return name === MCP_DEBUG_LOG_TOOL_NAME || name === MCP_DEBUG_REFRESH_TOOL_NAME;
}

/**
 * Execute one of the built-in debug tools. The result is always a text
 * `content[]` plus `structuredContent` so callers get a parseable payload
 * regardless of `appConfig.mcp.tools.answerAs`.
 */
export async function handleBuiltinDebugTool(params: IToolHandlerParams): Promise<TToolHandlerResponse> {
  const { name, arguments: args } = params;

  if (name === MCP_DEBUG_LOG_TOOL_NAME) {
    const type = String((args as any)?.type ?? 'unknown');
    const payload = (args as any)?.payload;
    emitTrace('app:view-log', { kind: 'log', type, payload });
    const text = `[mcp-debug-log] ${type}`;
    return {
      content: [{ type: 'text', text }],
      structuredContent: { logged: true, type },
    } as TToolHandlerResponse;
  }

  if (name === MCP_DEBUG_REFRESH_TOOL_NAME) {
    refreshCounter += 1;
    const timestamp = new Date().toISOString();
    return {
      content: [{ type: 'text', text: `Server timestamp: ${timestamp}` }],
      structuredContent: { timestamp, counter: refreshCounter },
    } as TToolHandlerResponse;
  }

  throw new Error(`Not a built-in debug tool: ${name}`);
}
