import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { IToolHandlerParams, TToolHandlerResponse } from '../../core/index.js';

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
}
