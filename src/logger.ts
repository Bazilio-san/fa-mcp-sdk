/* istanbul ignore file */
// noinspection JSUnusedGlobalSymbols

import { red, reset } from 'af-color';
import { appConfig } from './bootstrap/init-config.js';
import { getAFLogger, Logger, FileLogger, ILogObj } from 'af-logger-ts';

const { level, useFileLogger } = appConfig.logger;

// Check if we're in STDIO mode to disable console logging
const isStdioMode = appConfig.mcp.transportType === 'stdio';

let logger: Logger<ILogObj>;
let fileLogger: FileLogger | undefined;

if (appConfig.mcp.transportType === 'stdio') {
  logger = {} as Logger<ILogObj>;
  ['log', 'error', 'fatal', 'warn', 'info', 'debug', 'silly', 'trace'].forEach((level: string) => {
    // @ts-ignore
    logger![level] = (...args: unknown[]) => {
      process.stderr.write(`[MY LOG] ${args.map(String).join(' ')}\n`);
      return undefined;
    };
  });

  logger.getSubLogger = () => {
    return logger!;
  };
} else {
  const { logger: l, fileLogger: fl } = getAFLogger({
    level: isStdioMode ? 'error' : level, // Suppress most logs in STDIO mode
    maxSize: '500m',
    name: '\x1b[1P',
    filePrefix: appConfig.name,
    minLogSize: 0,
    minErrorLogSize: 0,
    prettyLogTemplate: '[{{hh}}:{{MM}}:{{ss}}]: {{logLevelName}} [{{name}}] ',
    prettyErrorTemplate: `${red}{{errorMessage}}${reset}\n{{errorStack}}`,
    maskValuesRegEx: [
      // API tokens and keys
      /token['":\s]+['"]\w+['"]/gi,
      /api[_-]?key['":\s]+['"]\w+['"]/gi,
      /secret['":\s]+['"]\w+['"]/gi,
      /password['":\s]+['"]\w+['"]/gi,
      // Authorization headers
      /authorization['":\s]+['"](basic|bearer)\s+\w+['"]/gi,
      // Email patterns (partial masking)
      /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
      // URL credentials
      /https?:\/\/[^:]+:[^@]+@/gi,
    ],
    noFileLogger: Boolean(useFileLogger),
  });
  logger = l;
  fileLogger = fl;
}


export { logger, fileLogger, useFileLogger };
