import chalk from 'chalk';

import {
  debugMcpTool,
  IToolHandlerParams,
  logger as lgr,
  ToolExecutionError,
  TToolHandlerResponse,
} from '../../core/index.js';

import { templateTools } from './tools.js';

const logger = lgr.getSubLogger({ name: chalk.bgGrey('tools') });

/**
 * Tool-call dispatcher.
 *
 * Routes an incoming `tools/call` to the matching tool's `handler` by name. Every tool lives in its
 * own file (see `tools.ts` and the "one tool = one file" convention in AGENTS.md); this file only
 * wires the registry into a name → handler map and applies the cross-cutting concerns — logging, the
 * optional debug hook (`DEBUG=mcp:tool`), and the unknown-tool guard. Add a tool by creating its file
 * and listing it in `tools.ts`; no change is needed here.
 */
const handlers = new Map(templateTools.map((t) => [t.definition.name, t.handler]));

export const handleToolCall = async (params: IToolHandlerParams): Promise<TToolHandlerResponse> => {
  const { name } = params;

  logger.info(`Tool called: ${name}`);

  const handler = handlers.get(name);
  if (!handler) {
    throw new ToolExecutionError(name, `Unknown tool: ${name}`);
  }

  try {
    const result = await handler(params);

    // Per-handler debug hook, in addition to the SDK-level wrapper. Enable with `DEBUG=mcp:tool`.
    if (debugMcpTool.enabled) {
      debugMcpTool(`handler[${name}] returned\n${JSON.stringify(result, null, 2)}`);
    }

    return result;
  } catch (error: Error | any) {
    logger.error(`Tool execution failed for ${name}:`, error);
    error.printed = true;
    throw error;
  }
};
