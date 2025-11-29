/*
Output of startup diagnostics to the console
*/
import { configInfo, consulInfo, databasesInfo, infoBlock, nodeConfigEnvInfo, TInfoLine } from 'af-tools-ts';
import { IAFConsulAPI } from 'af-consul-ts';
import { yellow } from 'af-color';
import { AppConfig } from '../_types_/config.js';
import { fileLogger, useFileLogger, logger as lgr } from '../logger.js';
import { getConsulAPI } from '../consul/get-consul-api.js';
import { IMeta } from 'af-consul-ts';
import chalk from 'chalk';
import { appConfig } from './init-config.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('config') });


export const startupInfo = async (args: { dotEnvResult: any, cfg: AppConfig }) => {
  const { cfg, dotEnvResult } = args;

  let consulInfoItem: string | [string, string] = '';
  const s = cfg.consul.service;
  let consulUI: string | undefined;
  if (s.enable) {
    const consulApi: IAFConsulAPI = await getConsulAPI();
    const r = consulApi.registerConfig;

    s.meta = r.meta as IMeta;
    s.tags = r.tags as string[];
    s.id = r.id;
    s.host = r.address || null;
    s.port = r.port || null;
    consulInfoItem = ['Consul serviceId', consulApi.serviceId];
    consulUI = '\nConsul UI: ' + consulApi.consulUI!;
  }

  configInfo({ dotEnvResult, cfg: JSON.parse(JSON.stringify(cfg)) }); // To display you must set ENV DEBUG=config-info

  const dbInfo = appConfig.isMainDBUsed ? [...databasesInfo(cfg, ['main'])] : [['DB', 'not used']];

  const info = [
    `${yellow}${cfg.productName || cfg.name} (v ${cfg.version})`,
    nodeConfigEnvInfo(),
    ['NODE VERSION', process.version],
    ['NODE_ENV', process.env.NODE_ENV],
    ['Logging level', cfg.logger.level],
    ['DEBUG', (process.env.DEBUG || '')],
    useFileLogger ? ['Logs dir', fileLogger?.logDir] : '',
    ...dbInfo,
    consulInfoItem,
  ].filter(Boolean) as TInfoLine[];

  const infoStr = infoBlock({ info });

  logger.info(`\n${infoStr}${consulUI}`);

  // Info about Access points
  consulInfo(cfg);
};
