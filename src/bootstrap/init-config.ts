// noinspection UnnecessaryLocalVariableJS

import './dotenv.js';  // Load environment variables first
import configModule from 'config';
import { AppConfig } from '../_types_/config.js';

export const config: AppConfig = configModule.util.toObject();

import { readFileSync } from 'fs';
import * as path from 'path';

const { name, productName, version, description, keywords, repository } = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));

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
    repo: repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
  };
  cfg.consul.service = { ...cfg.consul.service, name, version, description };
  cfg.consul.service.tags = keywords;
  cfg.mcp.transportType = process.argv[2] === 'stdio' ? 'stdio' : config.mcp.transportType;

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


