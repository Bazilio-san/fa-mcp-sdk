import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { getPrompt, getPromptsList } from './prompts.js';
import { getResource, getResourcesList } from './resources.js';
import { IGetPromptRequest, IReadResourceRequest } from '../_types_/types.js';
import { getTools } from '../utils/utils.js';

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

  const stdioArgs = { transport: 'stdio' as const };

  // Handler for listing available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await getTools(stdioArgs);
    return { tools };
  });

  // Handler for tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { toolHandler } = getProjectData();
    const result = await toolHandler({ ...request.params, ...stdioArgs });
    return { content: result.content };
  });

  // Handler for listing available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => getPromptsList(stdioArgs));

  // Handler for getting prompt content
  // @ts-ignore
  server.setRequestHandler(GetPromptRequestSchema, async (request: IGetPromptRequest) => await getPrompt(request, stdioArgs));

  // Handler for listing available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => getResourcesList());

  // Handler for reading resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request: IReadResourceRequest) => {
    return await getResource(request.params.uri) as any;
  });

  return server;
}
