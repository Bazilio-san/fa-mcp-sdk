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
import { logInternalError } from '../errors/errors.js';
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

function hasRequiredScopes(required: unknown, payload: unknown): boolean {
  if (appConfig.webServer.auth.enabled !== true) {
    return true;
  }
  const requiredScopes = Array.isArray(required) ? required.filter((scope) => typeof scope === 'string') : [];
  const tokenScopes = new Set(
    String((payload as any)?.scope ?? '')
      .split(/\s+/)
      .filter(Boolean),
  );
  return requiredScopes.every((scope) => tokenScopes.has(scope));
}

export async function handleHomeInfo(req: Request, res: Response): Promise<void> {
  try {
    const { version, repo } = appConfig;
    const serviceTitle = appConfig.productName
      .replace(/MCP/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const logoSvg = getLogoSvg();
    const payload = (req as any).authInfo?.payload;
    const httpArgs = { transport: 'http' as const, ...(payload ? { payload } : {}) };
    const { resources: allResources } = await getResourcesList(httpArgs);
    const { prompts: allPrompts } = await getPromptsList(httpArgs);
    const resources = allResources.filter((resource) => hasRequiredScopes(resource.requiredScopes, payload));
    const prompts = allPrompts.filter((prompt) => hasRequiredScopes((prompt as any).requiredScopes, payload));
    const { httpComponents } = global.__MCP_PROJECT_DATA__;
    const toolsOrFn = global.__MCP_PROJECT_DATA__.tools;
    let tools: Tool[] = typeof toolsOrFn === 'function' ? await toolsOrFn(httpArgs) : toolsOrFn;
    tools = tools.filter((tool: any) =>
      hasRequiredScopes(tool?._meta?.requiredScopes ?? tool?.requiredScopes, payload),
    );
    const { toolPrompt } = getProjectData();

    // Honestly probe every tool for a non-empty tool-specific prompt. The `tool_prompt` prompt is
    // advertised over MCP unconditionally, but on the home page it should appear only when at least
    // one tool actually returns a non-empty prompt. We collect the names of such tools so the viewer
    // can offer a dropdown, and drop `tool_prompt` from the home prompt list when none qualify.
    const toolPromptTools: string[] = [];
    let homePrompts = prompts;
    if (typeof toolPrompt === 'function') {
      for (const tool of tools) {
        try {
          const text = await toolPrompt(
            { method: 'prompts/get', params: { name: 'tool_prompt', arguments: { tool: tool.name } } },
            { tool: tool.name },
          );
          if (typeof text === 'string' && text.trim()) {
            toolPromptTools.push(tool.name);
          }
        } catch {
          // A tool whose prompt resolver throws is treated as having no prompt.
        }
      }
    }
    if (toolPromptTools.length === 0) {
      homePrompts = prompts.filter((p) => p.name !== 'tool_prompt');
    }

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

    // Dependency details are intentionally reduced to state; hosts, ports, database names,
    // service ids and Consul UI addresses are internal topology and never belong in this API.
    let db = null;
    if (appConfig.isMainDBUsed) {
      const dbStatus = await getMainDBConnectionStatus();
      db = {
        configured: true,
        connection: 'configured',
        status: dbStatus,
      };
    }

    const consul = appConfig.consul.service.enable ? { configured: true } : null;

    // Authentication info (same logic as startup-info.ts)
    const authConfig = appConfig.webServer?.auth;
    const adminPanelConfig = appConfig.adminPanel;
    const { configured: mcpAuthTypes } = detectAuthConfiguration();

    const mcpAuth = authConfig?.enabled
      ? mcpAuthTypes.length
        ? mcpAuthTypes.join(', ')
        : 'enabled but not configured'
      : 'disabled';

    let adminPanel: string | AdminAuthType | AdminAuthType[];
    if (!adminPanelConfig?.enabled) {
      adminPanel = 'disabled';
    } else {
      const rawAuthType = adminPanelConfig.authType;
      const types =
        !rawAuthType || rawAuthType === 'none'
          ? []
          : Array.isArray(rawAuthType)
            ? rawAuthType.filter((t) => t && t !== 'none')
            : [rawAuthType];
      adminPanel = types.length === 0 ? 'open (no auth)' : types.length === 1 ? types[0]! : (types as AdminAuthType[]);
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
      promptsCount: homePrompts.length,
      tools,
      resources,
      prompts: homePrompts,
      toolPromptTools,
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
    logInternalError(error, 'home_info');
    res.status(500).json({
      error: 'Failed to get home info',
      message: 'Internal error',
    });
  }
}
