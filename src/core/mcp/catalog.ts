import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  IClientCapabilities,
  IGetPromptRequest,
  IResource,
  ITransportContext,
  McpServerData,
} from '../_types_/types.js';
import { appConfig } from '../bootstrap/init-config.js';
import { getTools } from '../utils/utils.js';
import { getMetrics } from '../metrics/metrics.js';
import {
  applyDeprecationToDescription,
  assertDeprecationConsistency,
  readDeprecation,
  warnDeprecatedUsage,
} from './deprecation.js';
import { hostSupportsMcpApps } from './mcp-apps.js';
import { paginate } from './pagination.js';
import { getPrompt, getPromptsList } from './prompts.js';
import { getResource, getResourcesList, getResourceTemplatesList } from './resources.js';
import { truncateToolResponse } from './tool-limits.js';

/**
 * Core catalog/read/complete functions shared by every serving path: the legacy per-session
 * handlers in `create-mcp-server.ts`, the legacy `/sse` transport, and the v2 (2026-07-28)
 * per-request factory. One implementation of deprecation decoration, pagination and usage
 * warnings — the transport paths are thin adapters over these functions.
 */

/**
 * Standard §8.2 — which optional features this deployment actually serves, derived from config +
 * project data. Single source of truth for capability advertisement and handler registration in
 * BOTH eras (legacy `createMcpServer` and the v2 factory), so the advertised surface never drifts.
 */
export function computeServedFeatures(projectData: McpServerData | undefined) {
  const resourcesCfg = appConfig.mcp.resources;
  const hasPrompts = Boolean(
    (projectData?.agentBrief && projectData?.agentPrompt) ||
    typeof projectData?.customPrompts === 'function' ||
    (Array.isArray(projectData?.customPrompts) && projectData.customPrompts.length > 0),
  );
  return {
    hasPrompts,
    completionsEnabled:
      appConfig.mcp.completions?.enabled === true && typeof projectData?.completionProvider === 'function',
    tasksEnabled: appConfig.mcp.tasks?.enabled === true,
    subscribeEnabled: resourcesCfg?.subscribeEnabled === true,
    templatesEnabled: resourcesCfg?.templatesEnabled === true,
    loggingCapEnabled: appConfig.mcp.logging?.enabled !== false,
    validateInput: appConfig.mcp.tools?.validateInput !== false,
  };
}

type TDeprecatableKind = 'tool' | 'prompt' | 'resource';

const decorateDeprecated = <T extends { description?: string }>(
  kind: TDeprecatableKind,
  items: T[],
  keyOf: (item: T) => string,
): T[] =>
  items.map((item) => {
    const info = readDeprecation(item);
    if (!info) {
      return item;
    }
    assertDeprecationConsistency(kind, keyOf(item), info);
    return { ...item, description: applyDeprecationToDescription(item.description, info) };
  });

/** `tools/list` page: deprecation decoration + stable pagination (order is deterministic — `getTools` sorts). */
export async function listToolsPage(ctx: ITransportContext, cursor: string | undefined, pageSize: number) {
  const raw = await getTools(ctx);
  const tools = decorateDeprecated('tool', raw as Array<Tool & { description?: string }>, (t) => t.name);
  const { page, nextCursor } = paginate(tools, cursor, pageSize, (t) => t.name);
  return nextCursor ? { tools: page, nextCursor } : { tools: page };
}

/** `prompts/list` page: deprecation decoration + stable pagination. */
export async function listPromptsPage(ctx: ITransportContext, cursor: string | undefined, pageSize: number) {
  const result = await getPromptsList(ctx);
  const prompts = decorateDeprecated(
    'prompt',
    result.prompts as Array<{ name: string; description?: string }>,
    (p) => p.name,
  );
  const { page, nextCursor } = paginate(prompts, cursor, pageSize, (p) => p.name);
  return nextCursor ? { prompts: page, nextCursor } : { prompts: page };
}

/** `prompts/get` with the §17.2 deprecation usage warning. */
export async function getPromptWithWarn(request: IGetPromptRequest, ctx: ITransportContext) {
  const promptName = request.params?.name;
  if (promptName) {
    const { prompts } = await getPromptsList(ctx);
    const prompt = prompts.find((p: { name: string }) => p.name === promptName);
    warnDeprecatedUsage('prompt', promptName, readDeprecation(prompt));
  }
  return getPrompt(request, ctx);
}

/** `resources/list` page: deprecation decoration + stable pagination. */
export async function listResourcesPage(ctx: ITransportContext, cursor: string | undefined, pageSize: number) {
  const result = await getResourcesList(ctx);
  const resources = decorateDeprecated(
    'resource',
    result.resources as Array<{ uri: string; description?: string }>,
    (r) => r.uri,
  );
  const { page, nextCursor } = paginate(resources, cursor, pageSize, (r) => r.uri);
  return nextCursor ? { resources: page, nextCursor } : { resources: page };
}

/** `resources/read` with the §17.2 deprecation usage warning. */
export async function readResourceWithWarn(uri: string, ctx: ITransportContext): Promise<IResource> {
  if (uri) {
    const { resources } = await getResourcesList(ctx);
    const resource = resources.find((r: { uri: string }) => r.uri === uri);
    warnDeprecatedUsage('resource', uri, readDeprecation(resource));
  }
  return getResource(uri, ctx);
}

/** `resources/templates/list` page. */
export async function listTemplatesPage(ctx: ITransportContext, cursor: string | undefined, pageSize: number) {
  const templates = await getResourceTemplatesList(ctx);
  const { page, nextCursor } = paginate(
    templates,
    cursor,
    pageSize,
    (t: { uriTemplate?: string; name?: string }) => t.uriTemplate ?? t.name ?? '',
  );
  return nextCursor ? { resourceTemplates: page, nextCursor } : { resourceTemplates: page };
}

/** `completion/complete` core: provider call + the MCP 100-value cap with `hasMore`. */
export async function completeCore(
  params: {
    ref: { type: 'ref/prompt' | 'ref/resource'; name?: string; uri?: string };
    argument: { name: string; value: string };
    context?: Record<string, unknown>;
  },
  completionProvider: (req: {
    ref: { type: 'ref/prompt' | 'ref/resource'; name?: string; uri?: string };
    argument: { name: string; value: string };
    context?: Record<string, unknown>;
  }) => unknown,
) {
  const raw = await completionProvider({
    ref: params.ref,
    argument: params.argument,
    ...(params.context ? { context: params.context } : {}),
  });
  const all = Array.isArray(raw) ? raw.map(String) : [];
  const values = all.slice(0, 100);
  return { completion: { values, total: all.length, hasMore: all.length > values.length } };
}

/**
 * Standard §12.4 — mirror `structuredContent` into `content[0]` as JSON text for plain (non-UI)
 * clients; UI clients (MCP Apps) get `structuredContent` alone with a valid (possibly empty)
 * `content` array. Mutates and returns `response`.
 */
export function mirrorStructuredContent<T extends { structuredContent?: unknown; content?: unknown[] }>(
  response: T,
  clientCapabilities: IClientCapabilities | undefined,
): T {
  if (!response || typeof response !== 'object' || !('structuredContent' in response)) {
    return response;
  }
  const uiClient = hostSupportsMcpApps(clientCapabilities);
  const existingContent = Array.isArray(response.content) ? response.content : undefined;
  if (uiClient) {
    if (!existingContent) {
      response.content = [];
    }
    return response;
  }
  const hasText = existingContent?.some(
    (p) =>
      (p as { type?: string; text?: unknown })?.type === 'text' && typeof (p as { text?: unknown })?.text === 'string',
  );
  if (!hasText) {
    let serialized: string;
    try {
      serialized = JSON.stringify(response.structuredContent ?? null, null, 2);
    } catch {
      serialized = '';
    }
    response.content = [{ type: 'text', text: serialized }, ...(existingContent ?? [])];
  }
  return response;
}

/** Truncate per `mcp.limits` and observe the result-size metric. Shared by all tool-call paths. */
export function truncateAndObserve<T>(response: T): T {
  const truncated = truncateToolResponse(response as any) as T;
  try {
    const resultBytes = JSON.stringify(truncated ?? null).length;
    getMetrics()?.resultBytes.observe(resultBytes);
  } catch {
    // ignore serialization-only failures
  }
  return truncated;
}
