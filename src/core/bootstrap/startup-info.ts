/*
Output of startup diagnostics to the console
*/
import { yellow } from 'af-color';
import { configInfo, infoBlock, TInfoLine } from 'af-tools-ts';
import chalk from 'chalk';
import { IAFConsulAPI, IMeta } from 'fa-consul';

import { detectAuthConfiguration } from '../auth/multi-auth.js';
import { getConsulAPI } from '../consul/get-consul-api.js';
import { useFileLogger, logger as lgr } from '../logger.js';

import { appConfig as cfg } from './init-config.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('config') });

/** Preserve config structure for DEBUG=config-info without exposing any configured value. */
function keysOnly(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (Array.isArray(value)) {
    return `[array:${value.length}]`;
  }
  if (!value || typeof value !== 'object') {
    return `<${value === null ? 'null' : typeof value}>`;
  }
  if (seen.has(value)) {
    return '<circular>';
  }
  seen.add(value);
  return Object.fromEntries(Object.keys(value).map((key) => [key, keysOnly((value as any)[key], seen)]));
}

function safeDotEnvSummary(dotEnvResult: any): Record<string, unknown> {
  const parsed = dotEnvResult?.parsed;
  return {
    parsed:
      parsed && typeof parsed === 'object'
        ? Object.fromEntries(Object.keys(parsed).map((key) => [key, '<configured>']))
        : {},
    ...(dotEnvResult?.error ? { error: dotEnvResult.error?.name ?? 'DotenvError' } : {}),
  };
}

export const startupInfo = async (args: { dotEnvResult: any; customStartupInfo?: [string, string][] | undefined }) => {
  const { dotEnvResult } = args;

  let consulInfoItem: string | [string, string] = ['Consul', 'disabled'];
  const s = cfg.consul.service;
  if (s.enable) {
    const consulApi: IAFConsulAPI = await getConsulAPI();
    const r = consulApi.registerConfig;

    s.meta = r.meta as IMeta;
    s.tags = r.tags as string[];
    s.id = r.id;
    s.host = r.address || null;
    s.port = r.port || null;
    consulInfoItem = ['Consul', 'configured'];
  }

  // DEBUG=config-info is often enabled during troubleshooting. Never pass the actual config or
  // dotenv values to the formatter: both commonly contain tokens, passwords and connection strings.
  configInfo({ dotEnvResult: safeDotEnvSummary(dotEnvResult), cfg: keysOnly(cfg) });

  const dbInfo: TInfoLine[] = [['DB', cfg.isMainDBUsed ? 'configured' : 'not used']];

  // Authentication info
  const authConfig = cfg.webServer?.auth;
  const adminPanelConfig = cfg.adminPanel;
  const { configured: mcpAuthTypes, errors: authErrors } = detectAuthConfiguration();

  const mcpAuthInfo = authConfig?.enabled
    ? mcpAuthTypes.length
      ? mcpAuthTypes.join(', ')
      : 'enabled but not configured'
    : 'disabled';

  let adminPanelInfo: string;
  if (!adminPanelConfig?.enabled) {
    adminPanelInfo = 'disabled';
  } else {
    const raw = adminPanelConfig.authType;
    const types = !raw || raw === 'none' ? [] : Array.isArray(raw) ? raw.filter((t) => t && t !== 'none') : [raw];
    adminPanelInfo = types.length === 0 ? 'open (no auth)' : types.join(', ');
  }

  // Log auth configuration errors if any
  if (Object.keys(authErrors).length > 0) {
    Object.entries(authErrors).forEach(([type, errors]) => {
      logger.warn(`Auth config error [${type}] count=${(errors as string[]).length}`);
    });
  }

  const info = [
    `${yellow}${cfg.productName || cfg.name} (v ${cfg.version})`,
    ['NODE VERSION', process.version],
    ['NODE_ENV', process.env.NODE_ENV],
    ['Logging level', cfg.logger.level],
    ['DEBUG', process.env.DEBUG ? 'configured' : 'disabled'],
    useFileLogger ? ['File logging', 'enabled'] : '',
    ...dbInfo,
    ['MCP Auth', mcpAuthInfo],
    ['Admin Panel', adminPanelInfo],
    ['Gen JWT API', cfg.webServer?.genJwtApiEnable ? 'POST /gen-jwt' : 'disabled'],
    ...(args.customStartupInfo?.length
      ? ([['Custom startup fields', String(args.customStartupInfo.length)]] as TInfoLine[])
      : []),
    consulInfoItem,
  ].filter(Boolean) as TInfoLine[];

  const infoStr = infoBlock({ info });

  logger.info(`\n${infoStr}`);
};
