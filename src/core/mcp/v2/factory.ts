import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { CacheHint, McpRequestContext } from '@modelcontextprotocol/server';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { ITransportContext } from '../../_types_/types.js';
import { appConfig, getProjectData } from '../../bootstrap/init-config.js';
import { getTools, normalizeHeaders } from '../../utils/utils.js';
import { applyDeprecationToDescription, assertDeprecationConsistency, readDeprecation } from '../deprecation.js';

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
 * Per-request `McpServer` factory for the 2026-07-28 (modern) era and the v2 stateless legacy
 * fallback. `createMcpHandler` calls it once per HTTP request; nothing is shared between requests
 * (statelessness per the 2026-07-28 spec). Registered surface: tools from the project data.
 * Prompts/resources/completions join in the next migration stage; sessionful legacy clients are
 * served by the v1 path in `server-http.ts` and never reach this factory.
 */
export const v2ServerFactory = async (ctx: McpRequestContext): Promise<McpServer> => {
  const projectData = getProjectData();

  // ITransportContext for the tool handler — same shape the v1 handlers build from `extra`.
  const headers = ctx.requestInfo ? normalizeHeaders(Object.fromEntries(ctx.requestInfo.headers)) : undefined;
  const payload = (ctx.authInfo as { payload?: ITransportContext['payload'] } | undefined)?.payload;
  const transportCtx: ITransportContext = {
    transport: 'http',
    ...(headers ? { headers } : {}),
    ...(payload ? { payload } : {}),
  };

  // `server/discover` advertises the modern revisions only (v2 behavior): legacy clients never
  // call discover, and a modern client would not select a legacy revision anyway. Legacy support
  // is negotiated through the `initialize` handshake on the v1 session path.
  const server = new McpServer({ name: appConfig.name, version: appConfig.version }, { cacheHints: buildCacheHints() });

  const tools: Tool[] = await getTools(transportCtx);
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
      (async (args: unknown, toolCtx: { signal?: AbortSignal }) =>
        projectData.toolHandler({
          name: tool.name,
          arguments: args ?? {},
          ...transportCtx,
          ...(toolCtx?.signal ? { signal: toolCtx.signal } : {}),
          sendProgress: () => {},
        })) as any,
    );
  }

  return server;
};
