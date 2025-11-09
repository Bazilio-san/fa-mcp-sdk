import { getAPI } from 'af-consul-ts';
import { logger as lgr } from '../logger.js';
import { eventEmitter } from '../ee.js';
import { appConfig } from '../bootstrap/init-config.js';
import chalk from 'chalk';

const isProd = (process.env.NODE_CONSUL_ENV || process.env.NODE_ENV) === 'production';
const logger = lgr.getSubLogger({ name: chalk.bgBlue('consul') });

export const getConsulAPI = async () => getAPI({
  config: appConfig,
  logger,
  em: eventEmitter,
  envCode: isProd ? appConfig.consul.envCode.prod : appConfig.consul.envCode.dev,
  getConsulUIAddress: (serviceId: string) => `https://consul.entapp.work/ui/dc-${isProd ? 'msk-infra' : 'dev'}/services/${serviceId}/instances`,
});
