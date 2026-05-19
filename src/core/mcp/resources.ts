/**
 * MCP Resources for Agent
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { IUsedHttpHeader, IResource, IResourceData, IResourceInfo, ITransportContext } from '../_types_/types.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { ROOT_PROJECT_DIR } from '../constants.js';
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
  const { customResources, usedHttpHeaders: usedHttpHeadersRaw } = getProjectData();

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
    {
      uri: 'doc://readme',
      name: 'README.md',
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
  return [...resources, ...resolvedCustomResources];
};

export const getResourcesList = async (args: ITransportContext): Promise<{ resources: IResourceInfo[] }> => {
  const startedAt = Date.now();
  if (debugMcpResource.enabled) {
    debugMcpResource('→ resources/list');
  }
  emitTrace('mcp:resource', { kind: 'list-req' });
  const resources: IResourceData[] = await createResources(args);
  const result = { resources: resources.map(({ content, ...rest }) => ({ ...rest })) };
  const ms = Date.now() - startedAt;
  if (debugMcpResource.enabled) {
    debugMcpResource(`← resources/list (${result.resources.length})\n${JSON.stringify(result, null, 2)}`);
  }
  emitTrace('mcp:resource', { kind: 'list-res', count: result.resources.length, ms });
  return result;
};

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
    throw new Error(`Unknown resource: ${uri}`);
  }
  let { content } = resource;
  if (typeof content === 'function') {
    content = await content(uri);
  }
  if (!content) {
    emitTrace('mcp:resource', { kind: 'read-err', uri, ms: Date.now() - startedAt, error: 'no-content' });
    throw new Error(`Can not get content of resource '${uri}' by custom handler`);
  }
  const result: IResource = {
    contents: [
      {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: content,
        ...(resource._meta ? { _meta: resource._meta } : {}),
      },
    ],
  };
  const ms = Date.now() - startedAt;
  if (debugMcpResource.enabled) {
    const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    debugMcpResource(`← resources/read ${uri}\n${body}`);
  }
  emitTrace('mcp:resource', { kind: 'read-res', uri, ms });
  return result;
};
