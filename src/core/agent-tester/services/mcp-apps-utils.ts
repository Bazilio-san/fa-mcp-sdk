import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { MCP_APPS_RESOURCE_MIME_TYPE } from '../../mcp/mcp-apps.js';
import { IMcpAppUiResource, ITesterMcpTool } from '../types.js';

/**
 * Scan a `CallToolResult.content[]` for an embedded `mcp-app` resource. The
 * spec allows servers to either embed the resource directly or expose it via
 * `tool._meta.ui.resourceUri` for the host to fetch — this helper handles the
 * embedded case.
 */
export function findEmbeddedAppResource(result: unknown): IMcpAppUiResource | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const { content } = result as { content?: unknown };
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const r = (block as any).type === 'resource' ? (block as any).resource : null;
    if (!r || typeof r !== 'object') {
      continue;
    }
    if (r.mimeType === MCP_APPS_RESOURCE_MIME_TYPE && typeof r.text === 'string') {
      const ui: IMcpAppUiResource = {
        uri: typeof r.uri === 'string' ? r.uri : '',
        mimeType: r.mimeType,
        text: r.text,
      };
      if (r._meta?.ui) {
        ui.meta = r._meta.ui;
      }
      return ui;
    }
  }
  return undefined;
}

/**
 * Fetch a UI resource via `resources/read`. Returns `undefined` on any error
 * — callers are expected to log; the host MUST still ship a meaningful
 * text-only response when no UI resource is available.
 */
export async function readUiResource(client: Client, uri: string): Promise<IMcpAppUiResource | undefined> {
  try {
    const resource = await (client as any).readResource({ uri });
    const contents = Array.isArray(resource?.contents) ? resource.contents : [];
    const ui = contents.find(
      (c: any) => c && typeof c.text === 'string' && c.mimeType === MCP_APPS_RESOURCE_MIME_TYPE,
    );
    if (ui) {
      const out: IMcpAppUiResource = {
        uri: typeof ui.uri === 'string' ? ui.uri : uri,
        mimeType: ui.mimeType,
        text: ui.text,
      };
      if (ui._meta?.ui) {
        out.meta = ui._meta.ui;
      }
      return out;
    }
  } catch {
    /* caller decides whether to log */
  }
  return undefined;
}

/**
 * Read `_meta.ui.resourceUri` from a tool definition. Supports both the
 * nested (`_meta.ui.resourceUri`) and the legacy flat (`_meta["ui/resourceUri"]`)
 * shape, matching `@modelcontextprotocol/ext-apps/server` semantics.
 */
export function getToolUiResourceUri(tool: ITesterMcpTool | undefined): string | undefined {
  if (!tool) {
    return undefined;
  }
  const v = tool._meta?.ui?.resourceUri ?? (tool._meta?.['ui/resourceUri'] as unknown);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
