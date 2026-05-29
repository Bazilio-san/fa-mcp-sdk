/**
 * Standard §12.2 — optional helper for masking personal / sensitive data in tool results.
 *
 * The standard requires that sensitive data be protected according to the domain policy
 * (masking, filtering). That responsibility stays with the server: the SDK does not know the
 * domain model and cannot decide what counts as sensitive. This utility is a reusable building
 * block so a server need not re-implement masking from scratch — it is NOT wired into the
 * `tools/call` path automatically. Call it explicitly inside a tool handler before returning.
 *
 * Masking is driven purely by explicit rules (field names, regular expressions). It performs no
 * heuristic PII detection.
 */

export interface IMaskRules {
  /**
   * Field names whose values are fully masked wherever they occur in the object tree
   * (e.g. `['password', 'token', 'ssn']`). Matched case-insensitively.
   */
  fieldNames?: string[];
  /**
   * Regular expressions matched against string values at any depth. Every match is replaced
   * (e.g. card numbers, e-mail addresses). Use a global flag to replace all occurrences within a
   * single string; without it only the first occurrence is replaced.
   */
  patterns?: RegExp[];
  /**
   * Replacement applied when a rule fires. A string replaces the whole matched value (for
   * `fieldNames`) or the matched substring (for `patterns`); default `'***'`. A function receives
   * the original value and returns the masked form — useful for partial masking such as
   * `4111********1111`.
   */
  replacement?: string | ((original: string) => string);
}

const DEFAULT_REPLACEMENT = '***';

function applyReplacement(original: string, replacement: IMaskRules['replacement']): string {
  if (typeof replacement === 'function') {
    return replacement(original);
  }
  return replacement ?? DEFAULT_REPLACEMENT;
}

function maskString(value: string, patterns: RegExp[], replacement: IMaskRules['replacement']): string {
  let out = value;
  for (const re of patterns) {
    out = out.replace(re, (match) => applyReplacement(match, replacement));
  }
  return out;
}

/**
 * Recursively masks sensitive data in `value` according to `rules`, returning a new value.
 * The input is never mutated. Strings, arrays and plain objects are walked; other primitives
 * (numbers, booleans, null, undefined) are returned as-is. Field-name masking replaces the entire
 * value of a matching key regardless of its type.
 *
 * @example
 * maskSensitive({ password: 'p', name: 'a' }, { fieldNames: ['password'] });
 * // → { password: '***', name: 'a' }
 */
export function maskSensitive<T>(value: T, rules: IMaskRules): T {
  const fieldNames = new Set((rules.fieldNames ?? []).map((n) => n.toLowerCase()));
  const patterns = rules.patterns ?? [];
  const { replacement } = rules;

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return patterns.length > 0 ? maskString(node, patterns, replacement) : node;
    }
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }
    if (node && typeof node === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node)) {
        if (fieldNames.has(key.toLowerCase())) {
          result[key] = applyReplacement(typeof val === 'string' ? val : String(val), replacement);
        } else {
          result[key] = walk(val);
        }
      }
      return result;
    }
    return node;
  };

  return walk(value) as T;
}
