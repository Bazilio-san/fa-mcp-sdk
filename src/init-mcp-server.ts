import { McpServerData } from './types.js';
import { appConfig } from './bootstrap/init-config.js';
import { startupInfo } from './bootstrap/startup-info.js';
import { logger } from './logger.js';

// Imports to modify _core functions
import { createMcpServer } from './mcp/create-mcp-server.js';
import { startStdioServer } from './mcp/server-stdio.js';
import { startHttpServer } from './web/server-http.js';

/**
 * The main function of MCP server initialization
 * Accepts all design data and starts the server
 */
export async function initMcpServer(data: McpServerData): Promise<void> {
  logger.info('Initializing MCP Server with project data');

  // Existing startup logic
  await startupInfo();

  // Временно сохраняем данные в глобальном контексте для доступа из _core функций
  (global as any).__MCP_PROJECT_DATA__ = data; // VVA

  try {
    if (appConfig.mcp.transportType === 'stdio') {
      const server = createMcpServer();
      await startStdioServer(server);
    } else {
      await startHttpServer();
    }
  } catch (error) {
    logger.error('Failed to start MCP Server:', error);
    throw error;
  }
}
