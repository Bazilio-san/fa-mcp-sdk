// Import all project data from existing files
// @ts-ignore
import { appConfig, initMcpServer, McpServerData, getAsset } from 'fa-mcp-sdk';
import { tools } from './tools/tools.js';
import { handleToolCall } from './tools/handle-tool-call.js';
import { AGENT_BRIEF } from './prompts/agent-brief.js';
import { AGENT_PROMPT } from './prompts/agent-prompt.js';
import { customPrompts } from './prompts/custom-prompts.js';
import { customResources } from './custom-resources.js';
import { apiRouter, endpointsOn404 } from './api/router.js';
import { swagger } from './api/swagger.js';

const isConsulProd = (process.env.NODE_CONSUL_ENV || process.env.NODE_ENV) === 'production';

/**
 * Main function that assembles all project data and starts the MCP server
 */
const startProject = async (): Promise<void> => {
  // Read favicon from assets
  const favicon = getAsset('favicon.svg')!;

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
    getConsulUIAddress: (serviceId: string) => {
      const { agent } = appConfig.consul || {};
      if (!agent?.dev?.host || !agent?.prd?.host) {
        return '--consul-ui-not-configured--';
      }
      return `${isConsulProd
        ? `https://${agent.prd.host}/ui/dc-msk-infra`
        : `https://${agent.dev.host}/ui/dc-dev`
      }/services/${serviceId}/instances`;
    },
  };

  // Start MCP server with assembled data
  await initMcpServer(serverData);
};

startProject().catch(error => {
  console.error('Failed to start project:', error);
  process.exit(1);
});
