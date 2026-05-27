import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  IClientCapabilities,
  IGetPromptRequest,
  IReadResourceRequest,
  ITransportContext,
  TTransportType,
} from '../_types_/types.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { getTools, normalizeHeaders } from '../utils/utils.js';

import { getPrompt, getPromptsList } from './prompts.js';
import { getResource, getResourcesList } from './resources.js';

/**
 * Create MCP Server instance with registered tool and prompt handlers.
 *
 * The same `Server` is driven by every SDK transport (stdio + Streamable HTTP), so handlers build
 * their {@link ITransportContext} from the per-request `extra` (`RequestHandlerExtra`) that the SDK
 * passes as the second argument:
 *   - `extra.requestInfo.headers` — full request headers (HTTP only; absent on stdio);
 *   - `extra.authInfo` — whatever the transport read from `req.auth` (HTTP auth middleware bridge);
 *   - `server.getClientCapabilities()` — capabilities reported during the `initialize` handshake,
 *     reliable because each HTTP session owns its own `Server` instance (stateful transport).
 *
 * @param transportType — transport that owns this server instance, surfaced to handlers as
 *   `ITransportContext.transport`.
 */
export function createMcpServer(transportType: TTransportType): Server {
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

  const ctx = (extra: { requestInfo?: { headers?: Record<string, any> }; authInfo?: any }): ITransportContext => {
    const headers = extra.requestInfo?.headers ? normalizeHeaders(extra.requestInfo.headers) : undefined;
    const payload = extra.authInfo?.payload as ITransportContext['payload'];
    const caps = server.getClientCapabilities() as IClientCapabilities | undefined;
    return {
      transport: transportType,
      ...(headers ? { headers } : {}),
      ...(payload ? { payload } : {}),
      ...(caps ? { clientCapabilities: caps } : {}),
    };
  };

  // Handler for listing available tools
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    const tools = await getTools(ctx(extra));
    return { tools };
  });

  // Handler for tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { toolHandler } = getProjectData();
    return (await toolHandler({ ...request.params, ...ctx(extra) })) as any;
  });

  // Handler for listing available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async (_request, extra) => getPromptsList(ctx(extra)));

  // Handler for getting prompt content
  server.setRequestHandler(
    GetPromptRequestSchema,
    // @ts-ignore
    async (request: IGetPromptRequest, extra) => await getPrompt(request, ctx(extra)),
  );

  // Handler for listing available resources
  server.setRequestHandler(ListResourcesRequestSchema, async (_request, extra) => getResourcesList(ctx(extra)));

  // Handler for reading resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request: IReadResourceRequest, extra) => {
    return (await getResource(request.params.uri, ctx(extra))) as any;
  });

  return server;
}
