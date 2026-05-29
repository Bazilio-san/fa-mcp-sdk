/**
 * MCP Resources for Agent
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';

import {
  IUsedHttpHeader,
  IResource,
  IResourceBinaryContent,
  IResourceData,
  IResourceInfo,
  ITransportContext,
} from '../_types_/types.js';
import { collectAuthProfile } from '../auth/auth-profile.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { ROOT_PROJECT_DIR } from '../constants.js';
import { ResourceNotFoundError } from '../errors/specific-errors.js';
import { debugMcpResource } from '../debug.js';
import { emitTrace } from './debug-trace.js';
import { assembleReadmeWithSatellites } from './readme-assembler.js';

let readme = assembleReadmeWithSatellites(ROOT_PROJECT_DIR);
let packageJson: any;
try {
  packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_PROJECT_DIR, './package.json'), 'utf-8'));
  readme = readme.replace(/\[!\[Version]\([^)]+\)]\(([^)]+\))/, `Version: ${packageJson.version}`);
} catch (err) {
  console.error(err);
}

const createResources = async (args: ITransportContext): Promise<IResourceData[]> => {
  const { customResources, usedHttpHeaders: usedHttpHeadersRaw, agentBrief, agentPrompt } = getProjectData();

  // Resolve customResources - can be array or async function
  let resolvedCustomResources: IResourceData[] = [];
  if (customResources) {
    if (typeof customResources === 'function') {
      resolvedCustomResources = await customResources(args);
    } else {
      resolvedCustomResources = customResources;
    }
  }

  const resources: IResourceData[] = [
    {
      uri: 'project://id',
      name: 'project-id',
      description: `Stable identifier of the project.
Used:
- to identify the MCP server in the "MCP registry"
- when authorizing with a JWT token`,
      mimeType: 'text/plain',
      content: appConfig.name,
      requireAuth: false,
    },
    {
      uri: 'project://name',
      name: 'product-name',
      description: 'Human-readable product name for use in the UI',
      mimeType: 'text/plain',
      content: appConfig.productName,
      requireAuth: false,
    },
    // Standard §4 SHOULD — version surfaced via resources/read in addition to GET /health and serverInfo.
    {
      uri: 'project://version',
      name: 'project-version',
      title: 'Server version',
      description: 'Current server version (semver). Mirrors GET /health.version and serverInfo.version.',
      mimeType: 'text/plain',
      content: appConfig.version,
      requireAuth: false,
    },
    {
      uri: 'doc://readme',
      name: 'README.md',
      title: 'README',
      description: `Documentation of project '${appConfig.productName}':
Project description, purpose, features, data sources, installation, launch (STDIO/HTTP), MCP API, configuration, testing, deployment.
This information is used by searching for this MCP server and its information in the RAG system of the "MCP registry"
`,
      mimeType: 'text/markdown',
      content: readme,
      requireAuth: false,
    },
  ];
  const usedHttpHeaders = (usedHttpHeadersRaw || []) as IUsedHttpHeader[];

  resources.push({
    uri: 'use://http-headers',
    name: 'Used http headers',
    description: 'Used http headers',
    mimeType: 'application/json',
    content: usedHttpHeaders,
    requireAuth: false,
  });

  // Standard §11.2 SHOULD — describe enabled auth methods + claims for agent clients.
  resources.push({
    uri: 'use://auth',
    name: 'auth',
    description: 'Authentication profile: enabled schemes, methods, expected claims, header names.',
    mimeType: 'application/json',
    content: collectAuthProfile(),
    requireAuth: false,
  });

  // Standard §11.2 Avatar profile — service-scheme mirrors of agent_brief / agent_prompt.
  const serviceScheme = appConfig.name;
  const briefUri = `${serviceScheme}://agent/brief`;
  const promptUri = `${serviceScheme}://agent/prompt`;
  const customUris = new Set(resolvedCustomResources.map((r) => r.uri));

  if (agentBrief && !customUris.has(briefUri)) {
    resources.push({
      uri: briefUri,
      name: 'agent-brief',
      description: 'Mirror of prompt agent_brief. Routing-level (level 1) agent description.',
      mimeType: 'text/markdown',
      content: agentBrief,
      requireAuth: false,
    });
  }
  if (agentPrompt && !customUris.has(promptUri)) {
    resources.push({
      uri: promptUri,
      name: 'agent-prompt',
      description: 'Mirror of prompt agent_prompt. Detailed (level 2) agent instructions.',
      mimeType: 'text/markdown',
      content: agentPrompt,
      requireAuth: false,
    });
  }

  return [...resources, ...resolvedCustomResources];
};

/**
 * Standard §11.3 (MAY) — compute the byte size of a resource's content for `resources/list`.
 * Strings and objects are measured as they will be serialized; binary blobs by their byte length.
 * Returns `undefined` for lazy (function) content — computing it would require running the
 * function ahead of `resources/read`, so the size is simply not published in that case.
 */
function computeResourceSize(content: IResourceData['content']): number | undefined {
  if (typeof content === 'function') {
    return undefined;
  }
  if (typeof content === 'string') {
    return Buffer.byteLength(content, 'utf-8');
  }
  if (content && typeof content === 'object' && 'blob' in content) {
    const { blob } = content as IResourceBinaryContent;
    return Buffer.isBuffer(blob) ? blob.length : Buffer.byteLength(String(blob), 'utf-8');
  }
  // Plain object — measured as the JSON the transport will emit.
  return Buffer.byteLength(JSON.stringify(content), 'utf-8');
}

export const getResourcesList = async (args: ITransportContext): Promise<{ resources: IResourceInfo[] }> => {
  const startedAt = Date.now();
  if (debugMcpResource.enabled) {
    debugMcpResource('→ resources/list');
  }
  emitTrace('mcp:resource', { kind: 'list-req' });
  const resources: IResourceData[] = await createResources(args);
  const result = {
    resources: resources.map(({ content, ...rest }) => {
      // Publish `size` only when not already set by the author and computable without running
      // lazy content (standard §11.3).
      const size = rest.size ?? computeResourceSize(content);
      return size === undefined ? { ...rest } : { ...rest, size };
    }),
  };
  const ms = Date.now() - startedAt;
  if (debugMcpResource.enabled) {
    debugMcpResource(`← resources/list (${result.resources.length})\n${JSON.stringify(result, null, 2)}`);
  }
  emitTrace('mcp:resource', { kind: 'list-res', count: result.resources.length, ms });
  return result;
};

/**
 * Standard §11.5 — resources/templates/list handler. Returns project-supplied templates
 * (`customResourceTemplates` in McpServerData) or empty array.
 */
export const getResourceTemplatesList = async (args: ITransportContext): Promise<any[]> => {
  const projectData = getProjectData();
  const raw = (projectData as any)?.customResourceTemplates;
  if (!raw) {
    return [];
  }
  if (typeof raw === 'function') {
    return (await raw(args)) ?? [];
  }
  return Array.isArray(raw) ? raw : [];
};

/**
 * Standard §11.5 — resources/subscribe support. Subscriptions are tracked per server instance
 * (each HTTP session owns its own `Server`). Project code calls `notifyResourceUpdated` to
 * broadcast — only the current server's subscribers receive the notification.
 */
const subscribersByServer = new WeakMap<Server, Set<string>>();

export function subscribeResource(server: Server, uri: string): void {
  if (!uri) {
    return;
  }
  let set = subscribersByServer.get(server);
  if (!set) {
    set = new Set();
    subscribersByServer.set(server, set);
  }
  set.add(uri);
}

export function unsubscribeResource(server: Server, uri: string): void {
  const set = subscribersByServer.get(server);
  if (set) {
    set.delete(uri);
  }
}

export async function notifyResourceUpdated(server: Server, uri: string): Promise<void> {
  const set = subscribersByServer.get(server);
  if (!set || !set.has(uri)) {
    return;
  }
  try {
    await server.notification({
      method: 'notifications/resources/updated',
      params: { uri },
    });
  } catch {
    // best-effort — transport may be closed
  }
}

/**
 * Normalize {@link IResourceBinaryContent} to a base64 string for `contents[0].blob`.
 * Buffer → base64; string with `base64:false` → encode raw bytes; string otherwise → assumed
 * already base64 and passed through.
 */
function encodeBlob(bin: IResourceBinaryContent): string {
  if (Buffer.isBuffer(bin.blob)) {
    return bin.blob.toString('base64');
  }
  if (bin.base64 === false) {
    return Buffer.from(String(bin.blob), 'utf-8').toString('base64');
  }
  return String(bin.blob);
}

export const getResource = async (uri: string, args: ITransportContext): Promise<IResource> => {
  const startedAt = Date.now();
  if (debugMcpResource.enabled) {
    debugMcpResource(`→ resources/read ${uri}`);
  }
  emitTrace('mcp:resource', { kind: 'read-req', uri });
  const resources = await createResources(args);
  const resource = resources.find((r) => r.uri === uri);
  if (!resource) {
    emitTrace('mcp:resource', { kind: 'read-err', uri, ms: Date.now() - startedAt, error: 'unknown-resource' });
    // Standard §13 / Appendix B.2 — classify as -32002 (HTTP 404), not a generic -32603.
    throw new ResourceNotFoundError('Unknown resource', { uri, reason: 'unknown_resource' });
  }
  let { content } = resource;
  if (typeof content === 'function') {
    content = await (content as (u: string) => any)(uri);
  }
  if (!content) {
    emitTrace('mcp:resource', { kind: 'read-err', uri, ms: Date.now() - startedAt, error: 'no-content' });
    throw new ResourceNotFoundError('Resource has no content', { uri, reason: 'empty_content' });
  }

  // Standard §11.4 / §12.2 — a resource entry carries exactly one of `text` or `blob`. Binary
  // content is declared as { blob: Buffer | base64-string } and emitted as base64 `blob`.
  const isBinary = typeof content === 'object' && content !== null && 'blob' in (content as any);
  const baseEntry = {
    uri: resource.uri,
    mimeType: resource.mimeType,
    ...(resource._meta ? { _meta: resource._meta } : {}),
  };
  const result: IResource = {
    contents: [
      isBinary
        ? { ...baseEntry, blob: encodeBlob(content as IResourceBinaryContent) }
        : { ...baseEntry, text: content as string | object },
    ],
  };
  const ms = Date.now() - startedAt;
  if (debugMcpResource.enabled) {
    const body = isBinary ? '[binary blob]' : typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    debugMcpResource(`← resources/read ${uri}\n${body}`);
  }
  emitTrace('mcp:resource', { kind: 'read-res', uri, ms });
  return result;
};
