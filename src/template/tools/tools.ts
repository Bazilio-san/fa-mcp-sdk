import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { IResourceData } from '../../core/index.js';

import { exampleLongTask } from './example-long-task.js';
import { exampleSearch } from './example-search.js';
import { exampleTool } from './example-tool.js';
import { showWidget } from './show-widget.js';
import { ITemplateTool } from './tool.js';

/**
 * Tool registry.
 *
 * Convention (see AGENTS.md → "Tool organization"): **one tool = one file** in this folder, named
 * after the tool's `name` with `_` replaced by `-`. Each file exports a self-contained
 * {@link ITemplateTool} (its `definition` + `handler`). This file only lists them — to add a tool,
 * create `src/tools/<your-tool>.ts` and add its export here; the dispatcher in `handle-tool-call.ts`
 * routes calls to it automatically.
 */
export const templateTools: ITemplateTool[] = [exampleTool, exampleSearch, exampleLongTask, showWidget];

/** MCP wire definitions advertised in `tools/list`, derived from the registry. */
export const tools: Tool[] = templateTools.map((t) => t.definition);

/**
 * `ui://` resources owned by tools using the MCP Apps **referenced-widget** pattern (a tool declares
 * `_meta.ui.resourceUri` and ships the widget HTML as a separate resource — see `show_widget`).
 * `start.ts` merges these into the server's `customResources` so the host can `resources/read` them.
 */
export const templateUiResources: IResourceData[] = templateTools.flatMap((t) => t.uiResources ?? []);
