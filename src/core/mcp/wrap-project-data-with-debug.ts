import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { ITransportContext, IToolHandlerParams, McpServerData, TToolHandlerResponse } from '../_types_/types.js';
import { appConfig } from '../bootstrap/init-config.js';
import { DEBUG_TOOL, DEBUG_TOOL_NAME, handleDebugTool } from '../utils/testing/debug-tool.js';

import {
  BUILTIN_MCP_DEBUG_TOOLS,
  handleBuiltinDebugTool,
  isBuiltinDebugTool,
  MCP_DEBUG_LOG_TOOL_NAME,
  MCP_DEBUG_REFRESH_TOOL_NAME,
} from './builtin-debug-tools.js';

/**
 * Decorate the project handler with SDK-provided debug-tool routing. The canonical server pipeline
 * emits traces only after response validation/limiting, so this wrapper must not pre-commit outcomes.
 *
 * Kept separate from `init-mcp-server.ts` so focused tests can exercise the exact runtime wrapper
 * without importing transport/bootstrap lifecycle code.
 */
export function wrapProjectDataWithDebug(data: McpServerData): McpServerData {
  const builtinEnabled = appConfig.mcp?.debug?.builtinTools === true;
  const originalToolHandler = data.toolHandler;
  const wrappedToolHandler = async <T = unknown>(params: IToolHandlerParams): Promise<TToolHandlerResponse<T>> => {
    const { name } = params;
    if (builtinEnabled && isBuiltinDebugTool(name)) {
      return (await handleBuiltinDebugTool(params)) as TToolHandlerResponse<T>;
    }
    if (builtinEnabled && name === DEBUG_TOOL_NAME) {
      return (await handleDebugTool(params)) as TToolHandlerResponse<T>;
    }
    return originalToolHandler<T>(params);
  };

  let wrappedTools: McpServerData['tools'] = data.tools;
  let wrappedToolAliases = data.toolAliases;
  if (builtinEnabled) {
    const builtins: Tool[] = [...BUILTIN_MCP_DEBUG_TOOLS, DEBUG_TOOL];
    const original = data.tools;
    if (typeof original === 'function') {
      wrappedTools = async (ctx: ITransportContext) => [...(await original(ctx)), ...builtins];
    } else {
      wrappedTools = [...(original as Tool[]), ...builtins];
    }
    wrappedToolAliases = {
      ...data.toolAliases,
      'mcp-debug-log': MCP_DEBUG_LOG_TOOL_NAME,
      'mcp-debug-refresh': MCP_DEBUG_REFRESH_TOOL_NAME,
      'debug-tool': DEBUG_TOOL_NAME,
    };
  }

  return {
    ...data,
    tools: wrappedTools,
    ...(wrappedToolAliases ? { toolAliases: wrappedToolAliases } : {}),
    toolHandler: wrappedToolHandler,
  };
}
