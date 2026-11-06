import fs from 'fs';
import path from 'path';

import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { IOnBehalfOfIdentity, ITransportContext } from '../_types_/types.js';
import { appConfig } from '../bootstrap/init-config.js';
import { ROOT_PROJECT_DIR } from '../constants.js';
import { assertToolNames } from '../mcp/validate-tool-names.js';

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
  } catch (err) {
    console.error(err);
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

const ON_BEHALF_OF_PART_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

/**
 * Parse `x-on-behalf-of-user` without assigning any application-specific meaning to the domain.
 * Accepted forms are `username`, `domain\\username`, and `domain/username`.
 */
export const parseOnBehalfOfUser = (value: unknown): IOnBehalfOfIdentity | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const raw = value.trim();
  if (!raw) {
    return undefined;
  }
  const separators = [...raw].filter((character) => character === '\\' || character === '/');
  if (separators.length > 1) {
    return undefined;
  }
  if (!separators.length) {
    if (!ON_BEHALF_OF_PART_RE.test(raw)) {
      return undefined;
    }
    const username = raw.toLowerCase();
    return { raw, username, normalized: username };
  }
  const separator = separators[0]!;
  const parts = raw.split(separator);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return undefined;
  }
  const domain = parts[0].toLowerCase();
  const username = parts[1].toLowerCase();
  if (!ON_BEHALF_OF_PART_RE.test(domain) || !ON_BEHALF_OF_PART_RE.test(username)) {
    return undefined;
  }
  return { raw, domain, username, normalized: `${domain}\\${username}` };
};

/** Parse the normalized on-behalf-of header collection used by all HTTP MCP transports. */
export const getOnBehalfOfIdentity = (headers?: Record<string, string>): IOnBehalfOfIdentity | undefined =>
  parseOnBehalfOfUser(headers?.['x-on-behalf-of-user']);

export async function getTools(args: ITransportContext): Promise<Tool[]> {
  const toolsOrFn = global.__MCP_PROJECT_DATA__.tools;
  const rawTools: Tool[] = typeof toolsOrFn === 'function' ? await toolsOrFn(args) : (toolsOrFn as Tool[]);
  assertToolNames(rawTools);
  // Standard v2.0 §12.3 — deterministic order (stable byte-wise sort by name) so clients and LLM
  // prompt caches see an identical catalog on every call. Copy first: the project array must not
  // be mutated.
  const toolsArray = [...rawTools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const { hideAnnotations } = appConfig.mcp.tools || {};
  if (!hideAnnotations) {
    return toolsArray;
  }
  return toolsArray.map((tool) => {
    const { annotations: _annotations, ...rest } = tool;
    return rest as Tool;
  });
}
