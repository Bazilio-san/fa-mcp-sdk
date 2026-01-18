/**
 * MCP Resources for Agent
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROOT_PROJECT_DIR } from '../constants.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { IUsedHttpHeader, IResource, IResourceData, IResourceInfo, ITransportContext } from '../_types_/types.js';

let readme = fs.readFileSync(path.join(ROOT_PROJECT_DIR, './README.md'), 'utf-8');
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
  if (usedHttpHeaders.length) {
    resources.push(
      {
        uri: 'use://http-headers',
        name: 'Required http headers',
        description: 'Required http headers',
        mimeType: 'application/json',
        content: usedHttpHeaders,
        requireAuth: false,
      },
    );
  }
  return [...resources, ...resolvedCustomResources];
};

export const getResourcesList = async (args: ITransportContext): Promise<{ resources: IResourceInfo[] }> => {
  const resources: IResourceData[] = await createResources(args);
  return {
    resources: resources.map(({ content, ...rest }) => ({ ...rest })),
  };
};

export const getResource = async (uri: string, args: ITransportContext): Promise<IResource> => {
  const resources = await createResources(args);
  const resource = resources.find((r) => r.uri === uri);
  if (!resource) {
    throw new Error(`Unknown resource: ${uri}`);
  }
  let { content } = resource;
  if (typeof content === 'function') {
    content = await content(uri);
  }
  if (!content) {
    throw new Error(`Can not get content of resource '${uri}' by custom handler`);
  }
  return {
    contents: [
      {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: content,
      },
    ],
  };
};
