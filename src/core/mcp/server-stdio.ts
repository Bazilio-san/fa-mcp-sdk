import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMcpServer } from './create-mcp-server.js';

/**
 * Start STDIO server.
 *
 * The MCP `Server` is built here, NOT at module load time: `createMcpServer` reads
 * `global.__MCP_PROJECT_DATA__` to decide conditional capabilities (`prompts`, `completions`,
 * `tasks` — standard §8.2 / §8.7). `initMcpServer` only populates that global just before calling
 * this function, so an import-time construction would see empty project data and silently drop the
 * prompts capability (and its handlers) on stdio.
 */
export async function startStdioServer(): Promise<void> {
  const server = createMcpServer('stdio');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server running on stdio');
}
