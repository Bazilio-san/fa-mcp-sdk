import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { IResourceData, IToolHandlerParams, TToolHandlerResponse } from '../../core/index.js';

/**
 * One self-contained MCP tool.
 *
 * Convention (see AGENTS.md → "Tool organization"): **one tool = one file** in `src/tools/`, named
 * after the tool's `name` with every `_` replaced by `-` (`example_tool` → `example-tool.ts`). The
 * whole tool lives in that one file — its `definition` (name, title, description, `inputSchema` and
 * any optional `outputSchema` / `execution`), its `handler`, and any helpers or UI markup it alone
 * uses. The thin `tools.ts` (list) and `handle-tool-call.ts` (dispatcher) only aggregate and route.
 */
export interface ITemplateTool {
  /** MCP wire definition advertised in `tools/list`. */
  definition: Tool;
  /** Invoked on `tools/call`; receives the full transport context (args, capabilities, signal, …). */
  handler: (params: IToolHandlerParams) => Promise<TToolHandlerResponse> | TToolHandlerResponse;
  /**
   * Optional `ui://` resources this tool owns, for the MCP Apps **referenced-widget** pattern: the
   * tool declares `_meta.ui.resourceUri` in its {@link definition}, and the actual widget HTML lives
   * in one of these resources (fetched by the host via `resources/read`). `tools.ts` aggregates them
   * into `templateUiResources`, which `start.ts` merges into the server's `customResources`. Leave
   * unset for plain tools and for the **embedded-widget** pattern (see `example_tool`), where the
   * HTML is returned inline in the tool result instead.
   */
  uiResources?: IResourceData[];
}
