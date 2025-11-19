import { initMcpServer, McpServerData } from '../core/index.js';

// Import all project data from existing files
import { readFileSync } from 'fs';
import { join } from 'path';
import { tools } from './tools/tools.js';
import { handleToolCall } from './tools/handle-tool-call.js';
import { AGENT_BRIEF } from './prompts/agent-brief.js';
import { AGENT_PROMPT } from './prompts/agent-prompt.js';
import { customPrompts } from './prompts/custom-prompts.js';
import { customResources } from './custom-resources.js';
import { apiRouter, endpointsOn404 } from './api/router.js';
import { swagger } from './api/swagger.js';
import { appConfig } from '../core/bootstrap/init-config.js';

const isConsulProd = (process.env.NODE_CONSUL_ENV || process.env.NODE_ENV) === 'production';

/**
 * Template main function that assembles all project data and starts the MCP server
 * This serves as an example of how to use the fa-mcp-sdk library
 */
const startProject = async (): Promise<void> => {
  // Read favicon from assets
  const faviconPath = join(process.cwd(), 'src/template/asset/favicon.svg');
  let favicon: string;

  try {
    favicon = readFileSync(faviconPath, 'utf-8');
  } catch (_error) {
    // Fallback if favicon not found
    favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
<rect width="16" height="16" fill="${appConfig.uiColor.primary || '#007ACC'}"/>
</svg>`;
  }

  // Assemble all data to pass to the core
  const serverData: McpServerData = {
    // MCP components
    tools,
    toolHandler: handleToolCall,

    // Prompts
    agentBrief: AGENT_BRIEF,
    agentPrompt: AGENT_PROMPT,
    customPrompts,
    requiredHttpHeaders: [{ name: 'Authorization', description: 'JWT Token issued on request' }],
    // Resources
    customResources,

    // HTTP components
    httpComponents: {
      apiRouter,
      endpointsOn404,
      swagger: {
        swaggerSpecs: swagger.swaggerSpecs,
        swaggerUi: swagger.swaggerUi,
      },
    },

    // Assets
    assets: {
      favicon,
      maintainerHtml: '<a href="https://support.com/page/2805" target="_blank" rel="noopener" class="clickable">Support</a>',
    },
    // Function to get Consul UI address (if consul enabled: consul.service.enable = true)
    getConsulUIAddress: (serviceId: string) => `https://consul.my.ui/ui/dc-${isConsulProd ? 'prod' : 'dev'}/services/${serviceId}/instances`,
  };

  // Start MCP server with assembled data
  await initMcpServer(serverData);
};

startProject().catch(error => {
  console.error('Failed to start project:', error);
  process.exit(1);
});
