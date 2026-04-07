import chalk from 'chalk';
import { accessPointsUpdater } from 'fa-consul';

import { appConfig } from '../bootstrap/init-config.js';
import { eventEmitter } from '../ee.js';
import { logger as lgr } from '../logger.js';

const logger = lgr.getSubLogger({ name: chalk.bgBlue('consul') });

export const accessPointUpdater = {
  start: () => accessPointsUpdater.start({ config: appConfig, logger, em: eventEmitter }, 10_000),
  stop: () => accessPointsUpdater.stop(),
};
