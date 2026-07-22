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
import { logInternalError } from '../errors/errors.js';
import { ResourceNotFoundError } from '../errors/specific-errors.js';
import { debugMcpResource } from '../debug.js';
import { readDeprecation, warnDeprecatedUsage } from './deprecation.js';
import { emitTrace, safeTraceDescriptorName, traceDigest } from './debug-trace.js';
import { assertRequiredScopes, assertResolvedRequiredScopes } from './required-scopes.js';
import { assembleReadmeWithSatellites } from './readme-assembler.js';

let readme = assembleReadmeWithSatellites(ROOT_PROJECT_DIR);
let packageJson: any;
try {
  packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_PROJECT_DIR, './package.json'), 'utf-8'));
  readme = readme.replace(/\[!\[Version]\([^)]+\)]\(([^)]+\))/, `Version: ${packageJson.version}`);
} catch (err) {
  logInternalError(err, 'project_metadata_read');
}

const createResources = async (args: ITransportContext): Promise<IResourceData[]> => {
  const {
    customResources,
    usedHttpHeaders: usedHttpHeadersRaw,
    agentBrief,
    agentPrompt,
    defaultReadScopes,
  } = getProjectData();

  // Resolve customResources - can be array or async function
  let resolvedCustomResources: IResourceData[] = [];
  if (customResources) {
    if (typeof customResources === 'function') {
      resolvedCustomResources = await customResources(args);
    } else {
      resolvedCustomResources = customResources;
    }
  }
  assertResolvedRequiredScopes(resolvedCustomResources, 'resource');

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
      requireAuth: true,
    },
    {
      uri: 'project://name',
      name: 'product-name',
      description: 'Human-readable product name for use in the UI',
      mimeType: 'text/plain',
      content: appConfig.productName,
      requireAuth: true,
    },
    // Standard §4 SHOULD — version surfaced via resources/read in addition to GET /health and serverInfo.
    {
      uri: 'project://version',
      name: 'project-version',
      title: 'Server version',
      description: 'Current server version (semver). Mirrors GET /health.version and serverInfo.version.',
      mimeType: 'text/plain',
      content: appConfig.version,
      requireAuth: true,
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
      requireAuth: true,
    },
  ];
  const usedHttpHeaders = (usedHttpHeadersRaw || []) as IUsedHttpHeader[];

  resources.push({
    uri: 'use://http-headers',
    name: 'Used http headers',
    description:
      'Project-declared HTTP headers that clients may need for delegation or tool-specific behavior. Read before ' +
      'calling a tool when its header requirements are unknown. HTTP access requires authentication and configured ' +
      'read scopes. Generated from active McpServerData.usedHttpHeaders on each request; JSON array entries contain ' +
      'name, description, and optional isOptional.',
    mimeType: 'application/json',
    content: JSON.stringify(usedHttpHeaders, null, 2),
    requireAuth: true,
  });

  // Standard §11.2 SHOULD — describe enabled auth methods + claims for agent clients.
  resources.push({
    uri: 'use://auth',
    name: 'auth',
    description: 'Authentication profile: enabled schemes, methods, expected claims, header names.',
    mimeType: 'application/json',
    content: JSON.stringify(collectAuthProfile(), null, 2),
    requireAuth: true,
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
      requireAuth: true,
    });
  }
  if (agentPrompt && !customUris.has(promptUri)) {
    resources.push({
      uri: promptUri,
      name: 'agent-prompt',
      description: 'Mirror of prompt agent_prompt. Detailed (level 2) agent instructions.',
      mimeType: 'text/markdown',
      content: agentPrompt,
      requireAuth: true,
    });
  }

  const allResources = [...resources, ...resolvedCustomResources];
  if (!Array.isArray(defaultReadScopes) || defaultReadScopes.length === 0) {
    return allResources;
  }
  return allResources.map((resource) =>
    Array.isArray(resource.requiredScopes) ? resource : { ...resource, requiredScopes: [...defaultReadScopes] },
  );
};

/** Serialize authoring-time text/object content to the exact string placed on the MCP wire. */
function serializeResourceText(content: string | object): string {
  if (typeof content === 'string') {
    return content;
  }
  try {
    const serialized = JSON.stringify(content, null, 2);
    if (typeof serialized === 'string') {
      return serialized;
    }
  } catch {
    // Collapse JSON implementation details into one stable, secret-free error below.
  }
  throw new Error('Resource content is not JSON-serializable.');
}

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
  // Plain object — measured as the exact pretty JSON text the transport will emit.
  return Buffer.byteLength(serializeResourceText(content as object), 'utf-8');
}

export const getResourcesList = async (args: ITransportContext): Promise<{ resources: IResourceInfo[] }> => {
  const startedAt = Date.now();
  let count: number | undefined;
  let succeeded = false;
  if (debugMcpResource.enabled) {
    debugMcpResource('→ resources/list');
  }
  emitTrace('mcp:resource', { kind: 'list-req' });
  try {
    const resources: IResourceData[] = await createResources(args);
    const result = {
      resources: resources.map(({ content, ...rest }) => {
        // Publish `size` only when not already set by the author and computable without running
        // lazy content (standard §11.3).
        const size = rest.size ?? computeResourceSize(content);
        return size === undefined ? { ...rest } : { ...rest, size };
      }),
    };
    count = result.resources.length;
    succeeded = true;
    return result;
  } finally {
    const ms = Date.now() - startedAt;
    if (debugMcpResource.enabled) {
      debugMcpResource(succeeded ? `← resources/list count=${count ?? 0}` : `✗ resources/list failed durationMs=${ms}`);
    }
    emitTrace('mcp:resource', {
      kind: succeeded ? 'list-res' : 'list-err',
      name: '*',
      status: succeeded ? 'success' : 'error',
      ...(count === undefined ? {} : { count }),
      ms,
    });
  }
};

/**
 * Standard §11.5 — resources/templates/list handler. Returns project-supplied templates
 * (`customResourceTemplates` in McpServerData) or empty array.
 */
export const getResourceTemplatesList = async (args: ITransportContext): Promise<any[]> => {
  const projectData = getProjectData();
  const raw = projectData?.customResourceTemplates;
  if (!raw) {
    return [];
  }
  let templates: any[];
  if (typeof raw === 'function') {
    templates = (await raw(args)) ?? [];
  } else {
    templates = Array.isArray(raw) ? raw : [];
  }
  assertResolvedRequiredScopes(templates, 'resource template');
  const defaultReadScopes = projectData?.defaultReadScopes;
  if (!Array.isArray(defaultReadScopes) || defaultReadScopes.length === 0) {
    return templates;
  }
  return templates.map((template) =>
    Array.isArray(template.requiredScopes) ? template : { ...template, requiredScopes: [...defaultReadScopes] },
  );
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
  const uriHash = traceDigest(uri);
  let completionName = 'unknown';
  let completionNameHash = 'unknown';
  let succeeded = false;
  if (debugMcpResource.enabled) {
    debugMcpResource('→ resources/read');
  }
  emitTrace('mcp:resource', { kind: 'read-req', uriHash });
  try {
    const resources = await createResources(args);
    const resource = resources.find((candidate) => candidate.uri === uri);
    if (!resource) {
      // Standard §13 / Appendix B.2 — classify as -32002 (HTTP 404), not a generic -32603.
      throw new ResourceNotFoundError('Unknown resource', { reason: 'unknown_resource' });
    }
    assertRequiredScopes(resource.requiredScopes, args, 'resource');
    warnDeprecatedUsage('resource', resource.uri, readDeprecation(resource));
    // Dynamic providers control descriptor names. Log only strict machine identifiers; keep
    // human/PII-like names opaque while retaining a digest for correlation.
    completionNameHash = traceDigest(resource.name);
    completionName = safeTraceDescriptorName(resource.name) ?? 'opaque_descriptor';
    let { content } = resource;
    if (typeof content === 'function') {
      content = await (content as (u: string) => any)(uri);
    }
    if (!content) {
      throw new ResourceNotFoundError('Resource has no content', { reason: 'empty_content' });
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
          : { ...baseEntry, text: serializeResourceText(content as string | object) },
      ],
    };
    if (debugMcpResource.enabled) {
      const contentBytes = isBinary
        ? Buffer.byteLength(encodeBlob(content as IResourceBinaryContent), 'base64')
        : Buffer.byteLength(result.contents[0].text!, 'utf-8');
      debugMcpResource(
        `← resources/read name=${completionName} descriptorHash=${completionNameHash} ` +
          `binary=${isBinary} bytes=${contentBytes ?? 'unknown'}`,
      );
    }
    succeeded = true;
    return result;
  } finally {
    const ms = Date.now() - startedAt;
    if (debugMcpResource.enabled && !succeeded) {
      debugMcpResource(
        `✗ resources/read name=${completionName} descriptorHash=${completionNameHash} ` +
          `uriHash=${uriHash} durationMs=${ms}`,
      );
    }
    emitTrace('mcp:resource', {
      kind: succeeded ? 'read-res' : 'read-err',
      name: completionName,
      descriptorHash: completionNameHash,
      uriHash,
      status: succeeded ? 'success' : 'error',
      ms,
    });
  }
};
