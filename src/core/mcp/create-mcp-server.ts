import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import {
  IClientCapabilities,
  IGetPromptRequest,
  IReadResourceRequest,
  ITransportContext,
  TTransportType,
} from '../_types_/types.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { RateLimitedError } from '../errors/specific-errors.js';
import { getTools, normalizeHeaders } from '../utils/utils.js';

import { paginate, parsePageSize } from './pagination.js';
import { getPrompt, getPromptsList } from './prompts.js';
import {
  getResource,
  getResourcesList,
  getResourceTemplatesList,
  subscribeResource,
  unsubscribeResource,
} from './resources.js';
import { truncateToolResponse, withToolTimeout } from './tool-limits.js';
import { validateToolInput, validateToolOutput } from './validate-tool-args.js';

/**
 * Standard §14 — per-subject in-flight counter for tools/call. Keys are the JWT `sub`
 * (or 'anonymous' when auth is disabled / token is absent). Excess concurrent calls
 * raise RateLimitedError with the standard `Retry-After` semantics.
 */
const inFlightBySubject = new Map<string, number>();

function subjectKeyFromAuth(authInfo: any): string {
  const sub = authInfo?.payload?.sub ?? authInfo?.payload?.user ?? authInfo?.username;
  if (typeof sub === 'string' && sub.trim()) {
    return sub.trim().toLowerCase();
  }
  return 'anonymous';
}

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
  const resourcesCfg = appConfig.mcp.resources;
  const subscribeEnabled = resourcesCfg?.subscribeEnabled === true;
  const templatesEnabled = resourcesCfg?.templatesEnabled === true;
  const resourceCapability: Record<string, boolean> = {};
  if (subscribeEnabled) {
    resourceCapability.subscribe = true;
    resourceCapability.listChanged = true;
  }

  const server = new Server(
    {
      name: appConfig.name,
      version: appConfig.version,
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: resourceCapability,
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

  const pageSize = parsePageSize(appConfig.mcp.pagination?.pageSize);

  // Handler for listing available tools (standard §8.4 — server-side pagination).
  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const tools = await getTools(ctx(extra));
    const cursor = (request.params as any)?.cursor;
    const { page, nextCursor } = paginate(tools, cursor, pageSize, (t) => t.name);
    return nextCursor ? { tools: page, nextCursor } : { tools: page };
  });

  // Handler for tool execution. The call is wrapped by `withToolTimeout` (standard §14 —
  // `mcp.limits.toolTimeoutMs`) and `truncateToolResponse` (standard §12.2 — oversized
  // results are surfaced with explicit `truncated: true` markers). Arguments are validated
  // against the tool's `inputSchema` (standard §9.3); structuredContent is validated against
  // `outputSchema` (standard §9.4) and mirrored into `content[0]` as JSON text per §12.4.
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { toolHandler } = getProjectData();
    const toolName = (request.params as any)?.name ?? 'unknown';
    const args = (request.params as any)?.arguments ?? {};

    const tools = await getTools(ctx(extra));
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new McpError(-32602, `Unknown tool: ${toolName}`, { field: 'name', reason: 'unknown_tool' });
    }

    // Standard §7.5 — scope enforcement for tool dispatch. Scopes declared on tool._meta.requiredScopes
    // (preferred) or tool.requiredScopes are matched against the token's `scope` claim.
    const required: string[] = ((tool as any)._meta?.requiredScopes ?? (tool as any).requiredScopes ?? []) as string[];
    if (Array.isArray(required) && required.length > 0) {
      const tokenScopes = String((extra as any)?.authInfo?.payload?.scope ?? '')
        .split(/\s+/)
        .filter(Boolean);
      const missing = required.filter((s) => !tokenScopes.includes(s));
      if (missing.length > 0) {
        throw new McpError(-32004, `Missing scopes: ${missing.join(',')}`, {
          field: 'scope',
          reason: 'insufficient_scope',
          missing,
        });
      }
    }

    const inputCheck = validateToolInput(tool, args);
    if (!inputCheck.valid) {
      throw new McpError(-32602, 'Invalid params', { field: inputCheck.field, reason: inputCheck.reason });
    }

    // Standard §14 — per-subject concurrent in-flight cap.
    const maxConcurrent = appConfig.mcp.rateLimit?.maxConcurrentPerSubject ?? 16;
    const subjectKey = subjectKeyFromAuth((extra as any)?.authInfo);
    const current = inFlightBySubject.get(subjectKey) ?? 0;
    if (current >= maxConcurrent) {
      throw new RateLimitedError(
        `Too many concurrent tool calls for subject "${subjectKey}" (limit ${maxConcurrent})`,
        1,
      );
    }
    inFlightBySubject.set(subjectKey, current + 1);

    try {
      const response = (await withToolTimeout(
        toolName,
        () => toolHandler({ ...request.params, ...ctx(extra) }) as Promise<any>,
      )) as any;

      if (response && typeof response === 'object' && 'structuredContent' in response) {
        const outputCheck = validateToolOutput(tool, (response as any).structuredContent);
        if (!outputCheck.valid) {
          throw new McpError(-32603, 'Tool produced result that violates outputSchema', {
            field: outputCheck.field,
            reason: outputCheck.reason,
          });
        }
        // §12.4 — mirror structuredContent in content[0] as JSON text for legacy clients.
        const existingContent = Array.isArray((response as any).content) ? (response as any).content : undefined;
        const hasText = existingContent?.some((p: any) => p?.type === 'text' && typeof p?.text === 'string');
        if (!hasText) {
          let serialized: string;
          try {
            serialized = JSON.stringify((response as any).structuredContent ?? null, null, 2);
          } catch {
            serialized = '';
          }
          (response as any).content = [{ type: 'text', text: serialized }, ...(existingContent ?? [])];
        }
      }

      return truncateToolResponse(response) as any;
    } finally {
      const after = (inFlightBySubject.get(subjectKey) ?? 1) - 1;
      if (after <= 0) {
        inFlightBySubject.delete(subjectKey);
      } else {
        inFlightBySubject.set(subjectKey, after);
      }
    }
  });

  // Handler for listing available prompts (standard §8.4 — server-side pagination).
  server.setRequestHandler(ListPromptsRequestSchema, async (request, extra) => {
    const result = await getPromptsList(ctx(extra));
    const cursor = (request.params as any)?.cursor;
    const { page, nextCursor } = paginate(result.prompts, cursor, pageSize, (p: any) => p.name);
    return nextCursor ? { prompts: page, nextCursor } : { prompts: page };
  });

  // Handler for getting prompt content
  server.setRequestHandler(
    GetPromptRequestSchema,
    // @ts-ignore
    async (request: IGetPromptRequest, extra) => await getPrompt(request, ctx(extra)),
  );

  // Handler for listing available resources (standard §8.4 — server-side pagination).
  server.setRequestHandler(ListResourcesRequestSchema, async (request, extra) => {
    const result = await getResourcesList(ctx(extra));
    const cursor = (request.params as any)?.cursor;
    const { page, nextCursor } = paginate(result.resources, cursor, pageSize, (r: any) => r.uri);
    return nextCursor ? { resources: page, nextCursor } : { resources: page };
  });

  // Handler for reading resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request: IReadResourceRequest, extra) => {
    return (await getResource(request.params.uri, ctx(extra))) as any;
  });

  // Optional MAY: resources/templates/list — empty list if no templates configured.
  if (templatesEnabled) {
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request, extra) => {
      const templates = await getResourceTemplatesList(ctx(extra));
      const cursor = (request.params as any)?.cursor;
      const { page, nextCursor } = paginate(templates, cursor, pageSize, (t: any) => t.uriTemplate ?? t.name ?? '');
      return nextCursor ? { resourceTemplates: page, nextCursor } : { resourceTemplates: page };
    });
  }

  // Optional MAY: resources/subscribe + resources/unsubscribe — opt-in via config.
  if (subscribeEnabled) {
    server.setRequestHandler(SubscribeRequestSchema, async (request) => {
      const uri = (request.params as any)?.uri;
      subscribeResource(server, uri);
      return {};
    });
    server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
      const uri = (request.params as any)?.uri;
      unsubscribeResource(server, uri);
      return {};
    });
  }

  return server;
}
