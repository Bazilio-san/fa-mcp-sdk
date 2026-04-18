/**
 * Home page API endpoint
 * Returns all dynamic data needed for the home page
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Request, Response } from 'express';

import { AdminAuthType } from '../_types_/config.js';
import { detectAuthConfiguration } from '../auth/multi-auth.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { getMainDBConnectionStatus } from '../db/pg-db.js';
import { getPromptsList } from '../mcp/prompts.js';
import { getResourcesList } from '../mcp/resources.js';

import { getLogoSvg } from './favicon-svg.js';


const startTime = new Date();

const getUptime = (): string => {
  const uptimeMs = Date.now() - startTime.getTime();
  const uptimeSeconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
};

export async function handleHomeInfo (_req: Request, res: Response): Promise<void> {
  try {
    const { version, repo } = appConfig;
    const serviceTitle = appConfig.productName.replace(/MCP/i, '').replace(/\s{2,}/g, ' ').trim();
    const logoSvg = getLogoSvg();
    const httpArgs = { transport: 'http' as const };
    const { resources } = await getResourcesList(httpArgs);
    const { prompts } = await getPromptsList(httpArgs);
    const { httpComponents } = global.__MCP_PROJECT_DATA__;
    const toolsOrFn = global.__MCP_PROJECT_DATA__.tools;
    let tools: Tool[] = typeof toolsOrFn === 'function' ? await toolsOrFn(httpArgs) : toolsOrFn;
    const { getConsulUIAddress = (_s: string) => '' } = getProjectData();

    // Build footer HTML
    const footerParts: string[] = [];
    if (repo) {
      footerParts.push(`<a href="${repo}" target="_blank" rel="noopener">GitHub Repository</a>`);
    }
    const at = appConfig.agentTester;
    if (at?.enabled && at.showFooterLink !== false) {
      footerParts.push('<a href="/agent-tester">Agent Tester</a>');
    }
    const helpLink = appConfig.homePage?.helpLink;
    if (helpLink?.href) {
      const text = helpLink.text || 'Help';
      footerParts.push(`<a href="${helpLink.href}" target="_blank" rel="noopener">${text}</a>`);
    }
    const supportLink = appConfig.homePage?.maintainer;
    if (supportLink?.href) {
      const text = supportLink.text || 'Support';
      footerParts.push(`<a href="${supportLink.href}" target="_blank" rel="noopener">${text}</a>`);
    }

    // Database info
    let db = null;
    if (appConfig.isMainDBUsed) {
      const dbStatus = await getMainDBConnectionStatus();
      const { host, port, database } = appConfig.db.postgres!.dbs.main!;
      db = {
        connection: `${host}:${port}/${database}`,
        status: dbStatus,
      };
    }

    // Consul info
    let consul = null;
    if (appConfig.consul.service.enable) {
      const { id } = appConfig.consul.service;
      if (id) {
        consul = {
          id,
          url: getConsulUIAddress(id),
        };
      }
    }

    // Authentication info (same logic as startup-info.ts)
    const authConfig = appConfig.webServer?.auth;
    const adminPanelConfig = appConfig.adminPanel;
    const { configured: mcpAuthTypes } = detectAuthConfiguration();

    const mcpAuth = authConfig?.enabled
      ? (mcpAuthTypes.length ? mcpAuthTypes.join(', ') : 'enabled but not configured')
      : 'disabled';

    let adminPanel: string | AdminAuthType | AdminAuthType[];
    if (!adminPanelConfig?.enabled) {
      adminPanel = 'disabled';
    } else {
      const rawAuthType = adminPanelConfig.authType;
      const types = !rawAuthType || rawAuthType === 'none'
        ? []
        : (Array.isArray(rawAuthType) ? rawAuthType.filter((t) => t && t !== 'none') : [rawAuthType]);
      adminPanel = types.length === 0 ? 'open (no auth)' : (types.length === 1 ? types[0]! : types as AdminAuthType[]);
    }

    const response = {
      serviceTitle,
      description: appConfig.description,
      version,
      uptime: getUptime(),
      primaryColor: appConfig.uiColor.primary,
      logoSvg,
      toolsCount: tools.length,
      resourcesCount: resources.length,
      promptsCount: prompts.length,
      tools,
      resources,
      prompts,
      db,
      openAPI: !!httpComponents?.apiRouter,
      consul,
      mcpAuth,
      adminPanel,
      repo,
      agentTester: appConfig.agentTester?.enabled ? '/agent-tester' : null,
      footer: footerParts.join(' • '),
    };

    res.json(response);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get home info',
      message: error.message,
    });
  }
}
