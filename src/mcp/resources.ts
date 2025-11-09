/**
 * MCP Resources for Agent
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROOT_PROJECT_DIR } from '../constants.js';
import { appConfig } from '../bootstrap/init-config.js';
import { McpServerData } from '../types.js';

function getProjectData(): McpServerData {
  return (global as any).__MCP_PROJECT_DATA__;
}

let readme = fs.readFileSync(path.join(ROOT_PROJECT_DIR, './README.md'), 'utf-8');
let packageJson: any;
try {
  packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_PROJECT_DIR, './package.json'), 'utf-8'));
  readme = readme.replace(/\[!\[Version]\([^)]+\)]\(([^)]+\))/, `Version: ${packageJson.version}`);
} catch (err) {
  console.error(err);
}


function createResources() {
  const { customResources = [] } = getProjectData();
  return [
    {
      uri: `${appConfig.shortName}://readme`,
      name: `README — ${appConfig.productName}`,
      description: `${appConfig.productName} project documentation:
installation, launch (STDIO/HTTP), MCP API, configuration, testing and deployment.`,
      mimeType: 'text/plain',
      content: readme,
    },
    ...customResources
  ];
}

const resources = createResources();

export function getResourcesList () {
  return {
    resources: resources.map(({ content, ...rest }) => ({ ...rest })),
  };
}

export function getResource (uri: string) {
  const resource = resources.find((r) => r.uri === uri);

  if (!resource) {
    throw new Error(`Unknown resource: ${uri}`);
  }

  return {
    contents: [
      {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: resource.content,
      },
    ],
  };
}
