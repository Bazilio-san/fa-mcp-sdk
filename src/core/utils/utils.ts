import fs from 'fs';
import path from 'path';

import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { ITransportContext } from '../_types_/types.js';
import { ROOT_PROJECT_DIR } from '../constants.js';
import { assertToolSchemas } from '../mcp/validate-tool-args.js';
import { assertToolAliases, assertToolNames } from '../mcp/validate-tool-names.js';
import { getToolRequiredScopes } from '../mcp/required-scopes.js';

export const trim = (s: any): string => String(s || '').trim();

export const ppj = (v: any) => {
  return JSON.stringify(v, null, 2);
};

export const isObject = (o: any): boolean => o && typeof o === 'object';

export const isNonEmptyObject = (o: any): boolean =>
  isObject(o) && !Array.isArray(o) && Object.values(o).some((v) => v !== undefined);

export const isMainModule = (url: string) => {
  const modulePath = (process.argv[1] || '').replace(/\\/g, '/');
  url = url.replace(/file:\/+/, '');
  return modulePath && url === modulePath;
};

export const encodeSvgForDataUri = (svg: string): string => {
  // Encode SVG for use in data URI
  return encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
};

/**
 * Get asset file content by relative path from the <project root>/src/asset folder
 */
export const getAsset = (relPathFromAssetRoot: string): string | undefined => {
  const assetFilePath = path.join(ROOT_PROJECT_DIR, 'src/asset', relPathFromAssetRoot);
  if (!fs.existsSync(assetFilePath)) {
    return;
  }
  try {
    return fs.readFileSync(assetFilePath, 'utf8');
  } catch {
    console.error('Failed to read asset');
  }
  return;
};

/**
 * Normalize HTTP headers by converting all header names to lowercase
 * @param headers - Original headers object (from Express req.headers)
 * @returns Normalized headers object with lowercase keys
 */
export const normalizeHeaders = (headers: Record<string, any>): Record<string, string> => {
  const normalized: Record<string, string> = {};

  if (!headers || typeof headers !== 'object') {
    return normalized;
  }

  Object.entries(headers).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      // Convert header name to lowercase
      const normalizedKey = key.toLowerCase();

      // Convert value to string, handle arrays
      if (Array.isArray(value)) {
        normalized[normalizedKey] = value.join(', ');
      } else {
        normalized[normalizedKey] = String(value);
      }
    }
  });

  return normalized;
};

const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie']);
const CREDENTIAL_HEADER_NAME_RE = /(^|[-_])(auth|api[-_]?key|token|password|passwd|secret|credential)([-_]|$)/i;

/**
 * Headers exposed to project handlers. Authentication is propagated as verified `payload`; raw
 * credentials are intentionally removed so an application cannot accidentally forward bearer
 * tokens or browser cookies to a downstream service.
 */
export const normalizeTransportHeaders = (headers: Record<string, any>): Record<string, string> => {
  const normalized = normalizeHeaders(headers);
  for (const name of Object.keys(normalized)) {
    if (CREDENTIAL_HEADERS.has(name) || CREDENTIAL_HEADER_NAME_RE.test(name)) {
      delete normalized[name];
    }
  }
  return normalized;
};

export async function getTools(args: ITransportContext): Promise<Tool[]> {
  const toolsOrFn = global.__MCP_PROJECT_DATA__.tools;
  const toolsArray: Tool[] = typeof toolsOrFn === 'function' ? await toolsOrFn(args) : (toolsOrFn as Tool[]);
  assertToolNames(toolsArray);
  assertToolSchemas(toolsArray);
  assertToolAliases(toolsArray, global.__MCP_PROJECT_DATA__.toolAliases);
  toolsArray.forEach((tool) => getToolRequiredScopes(tool));
  return toolsArray;
}
