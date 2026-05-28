import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Standard §9.1 — corporate rule: tool names are ASCII snake_case, 1..63 chars.
 */
export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;

const validatedRefs = new WeakSet<object>();

/**
 * Throws on the first name that violates the rule. Memoizes the validated array reference
 * so static `tools` arrays pay the cost only once per process.
 */
export function assertToolNames(tools: Tool[]): void {
  if (!Array.isArray(tools) || validatedRefs.has(tools)) {
    return;
  }
  for (const tool of tools) {
    const name = (tool as any)?.name;
    if (typeof name !== 'string' || !TOOL_NAME_RE.test(name)) {
      throw new Error(
        `Tool name "${name}" violates standard §9.1: ` +
          `must match /^[a-z][a-z0-9_]{0,62}$/ (snake_case, ASCII, 1..63 chars).`,
      );
    }
  }
  validatedRefs.add(tools);
}
