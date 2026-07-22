import { McpError } from '@modelcontextprotocol/sdk/types.js';

import { ITransportContext } from '../_types_/types.js';
import { appConfig } from '../bootstrap/init-config.js';
import { MCP_ERROR_CODES } from '../errors/specific-errors.js';

const SCOPE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function invalidScopes(kind: string): Error {
  return new Error(`${kind}.requiredScopes must be an array of unique valid OAuth scope strings.`);
}

/** Strict validation: malformed server metadata must never be interpreted as public access. */
export function parseRequiredScopes(value: unknown, kind: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.some((scope) => typeof scope !== 'string' || !SCOPE_RE.test(scope)) ||
    new Set(value).size !== value.length
  ) {
    throw invalidScopes(kind);
  }
  return value;
}

export function assertEntryRequiredScopes(entry: unknown, kind: string): void {
  const value = entry && typeof entry === 'object' ? (entry as { requiredScopes?: unknown }).requiredScopes : undefined;
  parseRequiredScopes(value, kind);
}

/** Tool scopes may use the SDK field or MCP `_meta.requiredScopes`; validate both when present. */
export function getToolRequiredScopes(tool: unknown): string[] {
  const descriptor = tool && typeof tool === 'object' ? (tool as Record<string, any>) : {};
  const direct = descriptor.requiredScopes;
  const metadata = descriptor._meta?.requiredScopes;
  let directScopes: string[] | undefined;
  let metadataScopes: string[] | undefined;
  if (direct !== undefined) {
    directScopes = parseRequiredScopes(direct, 'tool');
  }
  if (metadata !== undefined) {
    metadataScopes = parseRequiredScopes(metadata, 'tool._meta');
  }
  if (
    directScopes &&
    metadataScopes &&
    (directScopes.length !== metadataScopes.length || directScopes.some((scope) => !metadataScopes.includes(scope)))
  ) {
    throw new Error('tool.requiredScopes and tool._meta.requiredScopes must declare the same scopes when both exist.');
  }
  return metadataScopes ?? directScopes ?? [];
}

export function assertStaticRequiredScopes(data: {
  tools?: unknown;
  customPrompts?: unknown;
  customResources?: unknown;
  customResourceTemplates?: unknown;
}): void {
  if (Array.isArray(data.tools)) {
    data.tools.forEach((tool) => getToolRequiredScopes(tool));
  }
  for (const [kind, entries] of [
    ['prompt', data.customPrompts],
    ['resource', data.customResources],
    ['resource template', data.customResourceTemplates],
  ] as const) {
    if (Array.isArray(entries)) {
      entries.forEach((entry) => assertEntryRequiredScopes(entry, kind));
    }
  }
}

export function assertResolvedRequiredScopes(entries: unknown[], kind: string): void {
  entries.forEach((entry) => assertEntryRequiredScopes(entry, kind));
}

export function isValidScope(scope: unknown): scope is string {
  return typeof scope === 'string' && SCOPE_RE.test(scope);
}

export function missingRequiredScopes(value: unknown, context: ITransportContext, kind: string): string[] {
  const required = parseRequiredScopes(value, kind);
  if (context.transport === 'stdio' || appConfig.webServer?.auth?.enabled !== true) {
    return [];
  }
  const available = new Set(
    String(context.payload?.scope ?? '')
      .split(/\s+/)
      .filter(Boolean),
  );
  return required.filter((scope) => !available.has(scope));
}

export function assertRequiredScopes(value: unknown, context: ITransportContext, kind: string): void {
  const missing = missingRequiredScopes(value, context, kind);
  if (missing.length === 0) {
    return;
  }
  throw new McpError(MCP_ERROR_CODES.SERVER_ERROR, 'Forbidden: token lacks a required scope', {
    field: 'scope',
    reason: 'insufficient_scope',
    missing,
  });
}
