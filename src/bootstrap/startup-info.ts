/*
Output of startup diagnostics to the console
*/
import { configInfo, consulInfo, databasesInfo, infoBlock, nodeConfigEnvInfo } from 'af-tools-ts';
import { yellow } from 'af-color';
import { AppConfig } from '../_types_/config.js';
import { fileLogger, useFileLogger, logger as lgr } from '../logger.js';
import { getConsulAPI } from '../consul/get-consul-api.js';
import { TInfoLine } from 'af-tools-ts/dist/types/interfaces.js';
import { IMeta } from 'af-consul-ts';
import { appConfig } from './init-config.js';
import chalk from 'chalk';

const logger = lgr.getSubLogger({ name: chalk.cyan('config') });

export const startupInfo = async (args: { dotEnvResult: any, cfg: AppConfig }) => {
  const { cfg, dotEnvResult } = args;
  const consulApi = await getConsulAPI();

  cfg.consul.service.meta = consulApi.registerConfig.meta as IMeta;
  cfg.consul.service.tags = consulApi.registerConfig.tags as string[];
  cfg.consul.service.id = consulApi.registerConfig.id;
  cfg.consul.service.host = consulApi.registerConfig.address || null;
  cfg.consul.service.port = consulApi.registerConfig.port || null;

  configInfo({ dotEnvResult, cfg: JSON.parse(JSON.stringify(cfg)) }); // To display you must set ENV DEBUG=config-info

  const info = [
    `${yellow}${cfg.description} (v ${cfg.version})`,
    nodeConfigEnvInfo(),
    ['NODE VERSION', process.version],
    ['NODE_ENV', process.env.NODE_ENV],
    ['MCP transport', appConfig.mcp.transportType],
    ['Logging level', cfg.logger.level],
    ['DEBUG', (process.env.DEBUG || '')],
    useFileLogger ? ['Logs dir', fileLogger?.logDir] : '',
    ...databasesInfo(cfg, ['main', 'globalData']),
    ['Consul serviceId', consulApi.serviceId],
  ].filter(Boolean) as TInfoLine[];

  const infoStr = infoBlock({ info });

  logger.info(`\n${infoStr}`);

  consulInfo(cfg);
};
