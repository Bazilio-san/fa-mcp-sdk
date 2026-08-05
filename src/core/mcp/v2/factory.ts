import { CLIENT_CAPABILITIES_META_KEY, McpServer, ProtocolError, fromJsonSchema } from '@modelcontextprotocol/server';
import type { CacheHint, McpRequestContext } from '@modelcontextprotocol/server';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { toMcpError } from '../../errors/errors.js';

import { IClientCapabilities, ITransportContext } from '../../_types_/types.js';
import { appConfig, getProjectData } from '../../bootstrap/init-config.js';
import { getMetrics } from '../../metrics/metrics.js';
import { getTools, normalizeHeaders } from '../../utils/utils.js';
import {
  completeCore,
  computeServedFeatures,
  getPromptWithWarn,
  listPromptsPage,
  listResourcesPage,
  listTemplatesPage,
  mirrorStructuredContent,
  readResourceWithWarn,
  truncateAndObserve,
} from '../catalog.js';
import {
  applyDeprecationToDescription,
  assertDeprecationConsistency,
  readDeprecation,
  warnDeprecatedUsage,
} from '../deprecation.js';
import { parsePageSize } from '../pagination.js';

/**
 * Standard v2.0 §12.3 — per-operation cache hints (`ttlMs` / `cacheScope`) for the cacheable
 * 2026-07-28 results. Values come from `mcp.cacheHints`; the SDK stamps the fields itself and
 * falls back to `ttlMs: 0` / `cacheScope: 'private'` when a hint is absent.
 */
const buildCacheHints = (): Record<string, CacheHint> => {
  const cfg = appConfig.mcp.cacheHints || {};
  const cacheScope = cfg.cacheScope === 'public' ? 'public' : 'private';
  const list: CacheHint = { ttlMs: cfg.listTtlMs ?? 60_000, cacheScope };
  const read: CacheHint = { ttlMs: cfg.readTtlMs ?? 0, cacheScope };
  return {
    'server/discover': list,
    'tools/list': list,
    'prompts/list': list,
    'resources/list': list,
    'resources/templates/list': list,
    'resources/read': read,
  };
};

/**
 * Translate errors thrown by our core functions into v2 `ProtocolError`s so the wire carries the
 * correct JSON-RPC code (our SDK-1 `McpError` / typed error classes are foreign to the v2
 * package and would collapse into a generic internal error). In the modern era "resource not
 * found" is `-32602` per the 2026-07-28 spec (`-32002` must not be emitted).
 */
const withV2Errors =
  <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      const mapped = toMcpError(error);
      const code = mapped.code === -32_002 ? -32_602 : mapped.code;
      // SDK-1 `McpError` prefixes its own message with "MCP error <code>: " — strip it, the wire
      // carries the numeric code separately.
      const message = mapped.message.replace(/^MCP error -?\d+: /, '');
      throw new ProtocolError(code, message, mapped.data);
    }
  };

/** Per-request client capabilities from the `_meta` envelope (modern era); undefined for the v2 stateless legacy fallback. */
const capsFromHandlerCtx = (handlerCtx: unknown): IClientCapabilities | undefined => {
  const meta = (handlerCtx as { mcpReq?: { _meta?: Record<string, unknown> } } | undefined)?.mcpReq?._meta;
  return meta?.[CLIENT_CAPABILITIES_META_KEY] as IClientCapabilities | undefined;
};

/**
 * Per-request `McpServer` factory for the 2026-07-28 (modern) era and the v2 stateless legacy
 * fallback. `createMcpHandler` calls it once per HTTP request; nothing is shared between requests
 * (statelessness per the 2026-07-28 spec). Tools are registered through `registerTool` (the v2
 * package validates arguments and answers schema violations as `isError: true` per standard v2.0
 * §9.4); prompts / resources / templates / completions are wired to the same core catalog
 * functions the legacy handlers use. Sessionful legacy clients are served by the v1 path in
 * `server-http.ts` and never reach this factory. Per-subject concurrency for `tools/call` is
 * enforced at the HTTP layer (before this handler) so its `-32003` stays a protocol error.
 */
export const v2ServerFactory = async (ctx: McpRequestContext): Promise<McpServer> => {
  const projectData = getProjectData();
  const feats = computeServedFeatures(projectData);
  const pageSize = parsePageSize(appConfig.mcp.pagination?.pageSize);

  // Connection-scoped part of ITransportContext; clientCapabilities join per handler call.
  const headers = ctx.requestInfo ? normalizeHeaders(Object.fromEntries(ctx.requestInfo.headers)) : undefined;
  const payload = (ctx.authInfo as { payload?: ITransportContext['payload'] } | undefined)?.payload;
  const baseCtx: ITransportContext = {
    transport: 'http',
    ...(headers ? { headers } : {}),
    ...(payload ? { payload } : {}),
  };
  const ctxFor = (handlerCtx: unknown): ITransportContext => {
    const caps = capsFromHandlerCtx(handlerCtx);
    return caps ? { ...baseCtx, clientCapabilities: caps } : baseCtx;
  };

  // `server/discover` advertises the modern revisions only (v2 behavior): legacy clients never
  // call discover, and a modern client would not select a legacy revision anyway. Legacy support
  // is negotiated through the `initialize` handshake on the v1 session path.
  const server = new McpServer(
    { name: appConfig.name, version: appConfig.version },
    {
      cacheHints: buildCacheHints(),
      // Capabilities for the hand-registered (non-registerTool) surface below; `tools` is merged
      // in by `registerTool` itself. `subscribe`/`listChanged` signal `subscriptions/listen`
      // support: the v2 handler honors a listen-filter entry only when the matching capability is
      // declared, and change events are published through `mcpNotify` (see `v2/handler.ts`).
      capabilities: {
        resources: { subscribe: true, listChanged: true },
        ...(feats.hasPrompts ? { prompts: { listChanged: true } } : {}),
        ...(feats.completionsEnabled ? { completions: {} } : {}),
      },
    },
  );

  const tools: Tool[] = await getTools(baseCtx);
  for (const tool of tools) {
    const deprecation = readDeprecation(tool);
    if (deprecation) {
      assertDeprecationConsistency('tool', tool.name, deprecation);
    }
    const description = deprecation ? applyDeprecationToDescription(tool.description, deprecation) : tool.description;
    server.registerTool(
      tool.name,
      {
        ...(description ? { description } : {}),
        inputSchema: fromJsonSchema(tool.inputSchema as Record<string, unknown>),
        ...(tool.outputSchema ? { outputSchema: fromJsonSchema(tool.outputSchema as Record<string, unknown>) } : {}),
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        ...(tool.icons ? { icons: tool.icons } : {}),
        ...(tool._meta ? { _meta: tool._meta } : {}),
      },
      (async (args: unknown, toolCtx: { signal?: AbortSignal }) => {
        warnDeprecatedUsage('tool', tool.name, deprecation);
        const stopTimer = getMetrics()?.toolDuration.startTimer({ tool: tool.name });
        let outcome: 'ok' | 'error' = 'ok';
        try {
          const caps = capsFromHandlerCtx(toolCtx);
          const response = await projectData.toolHandler({
            name: tool.name,
            arguments: args ?? {},
            ...baseCtx,
            ...(caps ? { clientCapabilities: caps } : {}),
            ...(toolCtx?.signal ? { signal: toolCtx.signal } : {}),
            sendProgress: () => {},
          });
          return truncateAndObserve(mirrorStructuredContent(response as any, caps));
        } catch (error) {
          outcome = 'error';
          throw error;
        } finally {
          stopTimer?.();
          getMetrics()?.toolCalls.inc({ tool: tool.name, status: outcome });
        }
      }) as any,
    );
  }

  // Prompts / resources / templates / completions — same core catalog functions as the legacy
  // handlers, registered on the low-level v2 server so pagination and deprecation decoration stay
  // identical across eras.
  const rpc = server.server;
  if (feats.hasPrompts) {
    rpc.setRequestHandler(
      'prompts/list',
      withV2Errors(async (request, handlerCtx) =>
        listPromptsPage(ctxFor(handlerCtx), (request.params as { cursor?: string } | undefined)?.cursor, pageSize),
      ),
    );
    rpc.setRequestHandler(
      'prompts/get',
      withV2Errors(async (request, handlerCtx) => getPromptWithWarn(request as any, ctxFor(handlerCtx)) as any),
    );
  }
  rpc.setRequestHandler(
    'resources/list',
    withV2Errors(
      async (request, handlerCtx) =>
        listResourcesPage(
          ctxFor(handlerCtx),
          (request.params as { cursor?: string } | undefined)?.cursor,
          pageSize,
        ) as any,
    ),
  );
  rpc.setRequestHandler(
    'resources/read',
    withV2Errors(
      async (request, handlerCtx) =>
        readResourceWithWarn((request.params as { uri: string }).uri, ctxFor(handlerCtx)) as any,
    ),
  );
  if (feats.templatesEnabled) {
    rpc.setRequestHandler(
      'resources/templates/list',
      withV2Errors(
        async (request, handlerCtx) =>
          listTemplatesPage(
            ctxFor(handlerCtx),
            (request.params as { cursor?: string } | undefined)?.cursor,
            pageSize,
          ) as any,
      ),
    );
  }
  if (feats.completionsEnabled) {
    const { completionProvider } = projectData;
    rpc.setRequestHandler(
      'completion/complete',
      withV2Errors(async (request) => completeCore((request.params ?? {}) as any, completionProvider!) as any),
    );
  }

  return server;
};
