import { TPromptContentFunction } from '../../core/index.js';

/**
 * Tool-specific prompts served by the built-in `tool_prompt` prompt.
 *
 * The `tool_prompt` prompt is always advertised over MCP, but it returns a non-empty string only
 * for the tools listed here. Clients pass the tool name in the required `tool` argument; the home
 * page catalog viewer additionally shows a dropdown of the tools that have a non-empty prompt.
 *
 * Add an entry keyed by the MCP tool name to attach usage instructions to that tool.
 */
const TOOL_PROMPTS: Record<string, string> = {
  example_tool: `You are using the "example_tool" tool, which processes a text input and returns the result.

- Pass the text to process in the required "query" field.
- Keep the input concise; send one logical request at a time.
- Use the returned text as the processed output — do not re-process it again unless the user asks.`,

  example_search: `You are using the "example_search" tool, which performs a search with pagination and filtering.

- Put the search text in the required "query" field.
- Use "limit" (1-100, default 20) to cap the number of results; request only as many as you need.
- Use "threshold" (0-1) to drop low-similarity matches when precision matters more than recall.
- Read results from the "results" array; "total" reports how many matches exist overall.`,

  show_widget: `You are using the "show_widget" tool, which demonstrates an MCP Apps UI widget.

- Call it whenever the user asks to show or demonstrate a widget ("show widget").
- It takes no arguments.
- When MCP Apps is enabled the host renders the widget; you only need a one-line confirmation.
- When MCP Apps is disabled the tool returns the exact text "To demonstrate the widget, enable Apps mode".
  In that case relay that text to the user verbatim — do not paraphrase, translate, or add anything.`,
};

export const toolPrompt: TPromptContentFunction = (_request, args) => {
  const tool = args?.tool;
  if (!tool) {
    return '';
  }
  return TOOL_PROMPTS[tool] ?? '';
};
