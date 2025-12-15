import { getAPI } from 'fa-consul';
import { logger as lgr } from '../logger.js';
import { eventEmitter } from '../ee.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import chalk from 'chalk';

const isProd = (process.env.NODE_CONSUL_ENV || process.env.NODE_ENV) === 'production';
const logger = lgr.getSubLogger({ name: chalk.bgBlue('consul') });

export const getConsulAPI = async () => {
  return getAPI({
    config: appConfig,
    logger,
    em: eventEmitter,
    envCode: isProd ? appConfig.consul.envCode.prod : appConfig.consul.envCode.dev,
    getConsulUIAddress:
      getProjectData().getConsulUIAddress ||
      ((serviceId: string) => `Consul service id: ${serviceId}. Can not construct UI url because custom getConsulUIAddress function was not provided`),
  });
};
