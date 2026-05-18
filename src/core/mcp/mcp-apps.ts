import { IClientCapabilities } from '../_types_/types.js';

/**
 * Helpers for MCP Apps (UI-augmented MCP tools, SEP-1865).
 *
 * The MCP Apps spec lets servers ship a UI resource alongside a tool result.
 * The host advertises its support through a well-known key in
 * `initialize.capabilities.extensions`. SDK consumers can read that capability
 * from {@link IToolHandlerParams.clientCapabilities} or
 * {@link ITransportContext.clientCapabilities} and branch UI-augmented vs.
 * text-only tool variants accordingly.
 *
 * Mirrors `@modelcontextprotocol/ext-apps/server`: `getUiCapability`,
 * `RESOURCE_MIME_TYPE`, `EXTENSION_ID`. We re-implement here so the SDK
 * doesn't take a hard dependency on the ext-apps package — pure types and a
 * 10-line lookup.
 */

/** Extension key advertised by hosts that support MCP Apps. */
export const MCP_APPS_EXTENSION_ID = 'io.modelcontextprotocol/ui';

/** MIME type the host MUST receive for `ui://` resources. */
export const MCP_APPS_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * Shape of the value the host publishes under
 * `capabilities.extensions["io.modelcontextprotocol/ui"]`.
 */
export interface IMcpUiClientCapabilities {
  /**
   * MIME types the host can render as MCP App UI resources. Currently always
   * contains `text/html;profile=mcp-app`; future revisions of the spec may
   * add more.
   */
  mimeTypes?: string[];
  [key: string]: unknown;
}

/**
 * Extract the MCP Apps UI capability from a client's reported capabilities.
 *
 * @returns The capability payload when the host advertised the extension,
 *          `undefined` when it did not (treat as "no MCP Apps support").
 *
 * @example Branch a tool handler between UI-augmented and text-only responses
 * ```ts
 * import { getUiCapability, MCP_APPS_RESOURCE_MIME_TYPE } from 'fa-mcp-sdk';
 *
 * const uiCap = getUiCapability(params.clientCapabilities);
 * const supportsUi = !!uiCap?.mimeTypes?.includes(MCP_APPS_RESOURCE_MIME_TYPE);
 *
 * if (supportsUi) {
 *   return { content: [...], _meta: { ui: { resourceUri: 'ui://my/view.html' } } };
 * }
 * return { content: [{ type: 'text', text: renderTextSummary() }] };
 * ```
 */
export const getUiCapability = (
  clientCapabilities: IClientCapabilities | null | undefined,
): IMcpUiClientCapabilities | undefined => {
  const ext = clientCapabilities?.extensions?.[MCP_APPS_EXTENSION_ID];
  if (!ext || typeof ext !== 'object') {
    return undefined;
  }
  return ext as IMcpUiClientCapabilities;
};

/**
 * Convenience predicate: did the host advertise it can render `ui://`
 * resources with the standard `text/html;profile=mcp-app` MIME type?
 *
 * Returns `false` when capabilities are absent — handlers MUST then fall back
 * to text-only output.
 */
export const hostSupportsMcpApps = (clientCapabilities: IClientCapabilities | null | undefined): boolean => {
  const ui = getUiCapability(clientCapabilities);
  return !!ui?.mimeTypes?.includes(MCP_APPS_RESOURCE_MIME_TYPE);
};
