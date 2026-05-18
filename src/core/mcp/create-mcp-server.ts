import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { IClientCapabilities, IGetPromptRequest, IReadResourceRequest } from '../_types_/types.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { getTools } from '../utils/utils.js';

import { getPrompt, getPromptsList } from './prompts.js';
import { getResource, getResourcesList } from './resources.js';

/**
 * Create MCP Server instance with registered tool and prompt handlers.
 *
 * Tool/list/read handlers below all read `server.getClientCapabilities()` on
 * each call so they always pass the **current** capabilities to user code —
 * by the time `tools/call` arrives, the initialize handshake has completed
 * and the call returns the host's reported capabilities (including any
 * `extensions["io.modelcontextprotocol/ui"]` payload for MCP Apps).
 */
export function createMcpServer(): Server {
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

  const ctx = (): {
    transport: 'stdio';
    clientCapabilities?: IClientCapabilities;
  } => {
    const caps = server.getClientCapabilities() as IClientCapabilities | undefined;
    return caps ? { transport: 'stdio', clientCapabilities: caps } : { transport: 'stdio' };
  };

  // Handler for listing available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await getTools(ctx());
    return { tools };
  });

  // Handler for tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { toolHandler } = getProjectData();
    return (await toolHandler({ ...request.params, ...ctx() })) as any;
  });

  // Handler for listing available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => getPromptsList(ctx()));

  // Handler for getting prompt content
  server.setRequestHandler(
    GetPromptRequestSchema,
    // @ts-ignore
    async (request: IGetPromptRequest) => await getPrompt(request, ctx()),
  );

  // Handler for listing available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => getResourcesList(ctx()));

  // Handler for reading resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request: IReadResourceRequest) => {
    return (await getResource(request.params.uri, ctx())) as any;
  });

  return server;
}
