import { accessPointsUpdater } from 'af-consul-ts';
import { logger as lgr } from '../logger.js';
import { eventEmitter } from '../ee.js';
import { appConfig } from '../bootstrap/init-config.js';
import chalk from 'chalk';

const logger = lgr.getSubLogger({ name: chalk.bgBlue('consul') });

export const accessPointUpdater = {
  start: () => accessPointsUpdater.start({ config: appConfig, logger, em: eventEmitter }, 10_000),
  stop: () => accessPointsUpdater.stop(),
};
