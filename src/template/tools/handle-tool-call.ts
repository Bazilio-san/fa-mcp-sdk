import chalk from 'chalk';

import {
  debugMcpTool,
  formatToolResult,
  logger as lgr,
  ToolExecutionError,
  TToolHandlerResponse,
} from '../../core/index.js';

const logger = lgr.getSubLogger({ name: chalk.bgGrey('tools') });

/**
 * Template tool handler - customize this for your specific tools
 * This handles MCP tool execution requests
 *
 * Debug output for tool requests/responses is wired up centrally by the SDK
 * (see `init-mcp-server.ts`) and activated with `DEBUG=mcp:tool`. Other MCP
 * channels have their own switches: `DEBUG=mcp:resource`, `DEBUG=mcp:prompt`,
 * `DEBUG=mcp:notification`. Use `DEBUG=mcp:*` to enable them all at once.
 */
export const handleToolCall = async (params: { name: string; arguments?: any }): Promise<any> => {
  const { name, arguments: args } = params;

  logger.info(`Tool called: ${name}`);

  try {
    let result: TToolHandlerResponse;
    // TODO: Implement your tool routing logic here
    switch (name) {
      case 'example_tool':
        result = await handleExampleTool(args);
        break;

      default:
        throw new ToolExecutionError(name, `Unknown tool: ${name}`);
    }

    // Optional: per-handler debug hook, in addition to the SDK-level wrapper.
    // Useful if you want to inspect intermediate (pre-format) values inside a
    // specific tool — define a new Debug category in `src/lib/debug.ts` and
    // call it here. The example below piggybacks on the built-in switch.
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

/**
 * Example tool implementation
 * Replace this with your actual tool logic
 */
async function handleExampleTool(args: any): Promise<TToolHandlerResponse> {
  const { query } = args || {};

  if (!query) {
    throw new ToolExecutionError('example_tool', 'Query parameter is required');
  }

  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 100));

  const result = {
    message: `Processed query: ${query}`,
    timestamp: new Date().toISOString(),
  };

  return formatToolResult(result);
}

// TODO: Add more tool handlers here
// async function handleAnotherTool(args: any): Promise<string> {
//   // Your implementation
// }
