import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Standard §9.1 — corporate rule: tool names match the normative expression exactly.
 */
export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

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
          `must match /^[a-z][a-z0-9_]{1,63}$/ (snake_case, ASCII, 2..64 chars).`,
      );
    }
  }
  validatedRefs.add(tools);
}

/**
 * Validate hidden migration aliases. Alias keys are deliberately not subject to {@link TOOL_NAME_RE}:
 * their only purpose is accepting an already-published legacy name while the canonical descriptor is
 * migrated. Aliases never appear in `tools/list`.
 */
export function assertToolAliases(tools: Tool[], aliases?: Record<string, string>): void {
  if (!aliases) {
    return;
  }
  if (typeof aliases !== 'object' || Array.isArray(aliases)) {
    throw new Error('toolAliases must be an object mapping legacy names to canonical tool names.');
  }

  const canonicalNames = new Set(tools.map((tool) => tool.name));
  for (const [alias, target] of Object.entries(aliases)) {
    if (!alias.trim()) {
      throw new Error('toolAliases contains an empty alias.');
    }
    if (canonicalNames.has(alias)) {
      throw new Error(`Tool alias "${alias}" shadows a canonical tool name.`);
    }
    if (typeof target !== 'string' || !canonicalNames.has(target)) {
      throw new Error(`Tool alias "${alias}" targets unknown canonical tool "${target}".`);
    }
  }
}

/** Resolve a request name to a canonical listed tool name after validating the alias map. */
export function resolveToolAlias(name: string, tools: Tool[], aliases?: Record<string, string>): string {
  assertToolAliases(tools, aliases);
  return aliases?.[name] ?? name;
}
