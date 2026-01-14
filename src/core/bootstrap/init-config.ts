// noinspection UnnecessaryLocalVariableJS

import './dotenv.js';  // Load environment variables first
import configModule from 'config';
import { AppConfig } from '../_types_/config.js';

export const config: AppConfig = configModule.util.toObject();

import { readFileSync } from 'fs';
import * as path from 'path';
import { trim } from '../utils/utils.js';
import { McpServerData } from '../_types_/types.js';

const { name, productName, version, description, keywords, repository, homepage } = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));

/**
 * Build application configuration from YAML and environment variables
 * Priority: environment variables > config.yaml > defaults
 */
function buildConfig (): AppConfig {
  const shortName = name.replace(/[\s\-]*\bmcp\b[\s\-]*/ig, '');
  const cfg: AppConfig = {
    ...config,
    // Package metadata from package.json
    name,
    shortName,
    productName,
    version,
    description,
  };

  const s = cfg.consul.service;
  if (s.name === '<name>') {
    s.name = name;
  }
  if (s.version === '<version>') {
    s.version = version;
  }
  if (s.description === '<description>') {
    s.description = description;
  }
  if (!s.tags?.length) {
    s.tags = keywords;
  }
  cfg.mcp.transportType = process.argv[2] === 'stdio' ? 'stdio' : config.mcp.transportType;
  cfg.isMainDBUsed = !!config.db?.postgres?.dbs?.main?.host;
  const urlRe = /\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|$!:,.;]*[A-Z0-9+&@#\/%=~_|$]/i;
  if (urlRe.test(trim(repository?.url))) {
    cfg.repo = urlRe.exec(repository.url)?.[0] || '';
  } else if (urlRe.test(trim(homepage))) {
    cfg.repo = urlRe.exec(homepage)?.[0] || '';
  }
  const pst = cfg.webServer?.auth?.permanentServerTokens as (string | string[] | undefined);
  if (typeof pst === 'string' && pst.includes(',')) {
    cfg.webServer.auth.permanentServerTokens = pst.split(',').map(trim);
  }

  return cfg;
}

export const appConfig: AppConfig = buildConfig();

/**
 * Returns configuration with sensitive data masked for safe display
 */
export function getSafeAppConfig (): any {
  const config = JSON.parse(JSON.stringify(appConfig)); // Deep clone

  // Mask database password
  if (config.db?.postgres?.dbs?.main?.password) {
    config.db.postgres.dbs.main.password = '[MASKED]';
  }

  return config;
}

export function getProjectData (): McpServerData {
  return global.__MCP_PROJECT_DATA__;
}

