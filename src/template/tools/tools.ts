import { Tool } from '@modelcontextprotocol/sdk/types.js';

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
