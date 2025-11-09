import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { appConfig } from '../bootstrap/init-config.js';
import { getPrompt, getPromptsList } from './prompts.js';
import { getResource, getResourcesList } from './resources.js';
import { McpServerData } from '../types.js';

function getProjectData(): McpServerData {
  return (global as any).__MCP_PROJECT_DATA__;
}

/**
 * Create MCP Server instance with registered tool and prompt handlers
 */
export function createMcpServer (): Server {
  const server = new Server(
    {
      name: appConfig.name,
      version: appConfig.version,
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    },
  );

  // Handler for listing available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools } = getProjectData();
    return { tools };
  });

  // Handler for tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { toolHandler } = getProjectData();
    const result = await toolHandler(request.params);
    return {
      content: result.content,
    };
  });

  // Handler for listing available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => getPromptsList());

  // Handler for getting prompt content
  server.setRequestHandler(GetPromptRequestSchema, async (request) => getPrompt(request.params.name));

  // Handler for listing available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => getResourcesList());

  // Handler for reading resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => getResource(request.params.uri));

  return server;
}
