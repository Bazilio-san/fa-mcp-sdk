/* istanbul ignore file */
// noinspection JSUnusedGlobalSymbols

import { red, reset } from 'af-color';
import { getAFLogger, Logger, FileLogger, ILogObj, ILoggerSettings } from 'af-logger-ts';

import { appConfig } from './bootstrap/init-config.js';

const { level, useFileLogger, dir: logDir, noMaskValues } = appConfig.logger;

const isStdioMode = appConfig.mcp.transportType === 'stdio';

const DEFAULT_MASK_VALUES_REG_EX: RegExp[] = [
  // API tokens and keys
  /token['":\s]+['"]\w+['"]/gi,
  /api[_-]?key['":\s]+['"]\w+['"]/gi,
  /secret['":\s]+['"]\w+['"]/gi,
  /password['":\s]+['"]\w+['"]/gi,
  // Authorization headers
  /authorization['":\s]+['"](basic|bearer)\s+\w+['"]/gi,
  // Email patterns (partial masking)
  // /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
  // URL credentials
  /https?:\/\/[^:]+:[^@]+@/gi,
];

function buildBaseSettings(): ILoggerSettings {
  const s: ILoggerSettings = {
    level: isStdioMode ? 'error' : level, // Suppress most logs in STDIO mode
    maxSize: '500m',
    name: '\x1b[1P',
    filePrefix: appConfig.name,
    minLogSize: 0,
    minErrorLogSize: 0,
    prettyLogTemplate: '[{{hh}}:{{MM}}:{{ss}}]: {{logLevelName}} [{{name}}] ',
    prettyErrorTemplate: `${red}{{errorMessage}}${reset}\n{{errorStack}}`,
    maskValuesRegEx: noMaskValues ? [] : DEFAULT_MASK_VALUES_REG_EX,
    noFileLogger: !useFileLogger,
  };
  if (useFileLogger && logDir) {
    s.logDir = logDir;
  }
  return s;
}

let userOverrides: Partial<ILoggerSettings> = {};
let realMain: Logger<ILogObj> | null = null;
let realFile: FileLogger | undefined;
const subCache = new Map<string, Logger<ILogObj>>();

function buildStdioLogger(): Logger<ILogObj> {
  const l: any = {};
  ['log', 'error', 'fatal', 'warn', 'info', 'debug', 'silly', 'trace'].forEach((lvl) => {
    l[lvl] = (...args: unknown[]) => {
      process.stderr.write(`[MY LOG] ${args.map(String).join(' ')}\n`);
      return undefined;
    };
  });
  l.getSubLogger = () => l;
  return l as Logger<ILogObj>;
}

function getMain(): Logger<ILogObj> {
  if (realMain) {
    return realMain;
  }
  if (isStdioMode) {
    realMain = buildStdioLogger();
    return realMain;
  }
  const settings = { ...buildBaseSettings(), ...userOverrides };
  const { logger: l, fileLogger: fl } = getAFLogger(settings);
  realMain = l;
  realFile = fl;
  return realMain;
}

function getSub(key: string, opts: unknown): Logger<ILogObj> {
  let s = subCache.get(key);
  if (!s) {
    s = getMain().getSubLogger(opts as any);
    subCache.set(key, s);
  }
  return s;
}

function makeSubProxy(opts: unknown): Logger<ILogObj> {
  const key = JSON.stringify(opts || {});
  return new Proxy({} as Logger<ILogObj>, {
    get(_t, prop) {
      if (prop === 'getSubLogger') {
        return (childOpts: unknown) => makeSubProxy(childOpts);
      }
      const target = getSub(key, opts);
      const v = (target as any)[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

const logger: Logger<ILogObj> = new Proxy({} as Logger<ILogObj>, {
  get(_t, prop) {
    if (prop === 'getSubLogger') {
      return (opts: unknown) => makeSubProxy(opts);
    }
    const m = getMain();
    const v = (m as any)[prop];
    return typeof v === 'function' ? v.bind(m) : v;
  },
});

const fileLogger: FileLogger | undefined = new Proxy({} as FileLogger, {
  get(_t, prop) {
    getMain(); // ensure init
    return (realFile as any)?.[prop];
  },
}) as FileLogger;

/**
 * Apply user-provided logger settings on top of the built-in defaults.
 * Only specified fields override defaults (shallow merge).
 * Resets the cached logger so subsequent log calls use the new settings.
 * No-op in STDIO mode (logging is redirected to stderr).
 */
export function applyLoggerSettings(overrides: Partial<ILoggerSettings> | undefined | null): void {
  if (isStdioMode || !overrides || Object.keys(overrides).length === 0) {
    return;
  }
  userOverrides = { ...userOverrides, ...overrides };
  realMain = null;
  realFile = undefined;
  subCache.clear();
}

export { logger, fileLogger, useFileLogger };
