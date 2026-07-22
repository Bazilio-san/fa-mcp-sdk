/* istanbul ignore file */
// noinspection JSUnusedGlobalSymbols

import { red, reset } from 'af-color';
import { getAFLogger, Logger, FileLogger, ILogObj, ILoggerSettings } from 'af-logger-ts';

import { appConfig } from './bootstrap/init-config.js';

const { level, useFileLogger, dir: logDir, disableMasking } = appConfig.logger;
const isProduction = (process.env.NODE_CONSUL_ENV || process.env.NODE_ENV) === 'production';
const maskingDisabled = disableMasking === true && !isProduction;

const isStdioMode = appConfig.mcp.transportType === 'stdio';

const DEFAULT_MASK_VALUES_REG_EX: RegExp[] = [
  // Header and standalone credentials. JWT/base64 values contain punctuation, so `\w+` is not enough.
  /["']?authorization["']?\s*[:=]\s*["']?(?:basic|bearer)\s+[^\s,"'}]+/gi,
  /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
  // Common serialized secret fields (JSON, YAML, dotenv and logfmt forms).
  /["']?(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|passwd)["']?\s*[:=]\s*["']?[^\s,"'}]+/gi,
  // PII and credentials embedded in URLs.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s@/]+@/gi,
  /[?&](?:access[_-]?token|token|api[_-]?key|secret|password)=[^&#\s]+/gi,
  // Internal endpoints and absolute filesystem paths are sensitive topology too.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi,
  /(?:[A-Za-z]:\\[^\s"']+|\/(?:home|usr|var|etc|root|opt|tmp|mnt|srv|Users)\/[^\s"']*)/g,
];

export function maskLogText(value: unknown): string {
  let text = String(value);
  if (maskingDisabled) {
    return text;
  }
  for (const pattern of DEFAULT_MASK_VALUES_REG_EX) {
    text = text.replace(pattern, '[REDACTED]');
  }
  return text;
}

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
    maskValuesRegEx: maskingDisabled ? [] : DEFAULT_MASK_VALUES_REG_EX,
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

function assertSafeProductionOverrides(overrides: Partial<ILoggerSettings>): void {
  if (!isProduction) {
    return;
  }
  const record = overrides as Record<string, unknown>;
  const { overwrite } = record;
  const overridesMaskFunction =
    Boolean(overwrite) &&
    typeof overwrite === 'object' &&
    !Array.isArray(overwrite) &&
    Object.hasOwn(overwrite as object, 'mask');
  if (Object.hasOwn(record, 'maskValuesRegEx') || Object.hasOwn(record, 'maskValuesOfKeys') || overridesMaskFunction) {
    throw new Error('loggerSettings cannot override secret-masking controls in production.');
  }
}

function buildStdioLogger(): Logger<ILogObj> {
  const l: any = {};
  ['log', 'error', 'fatal', 'warn', 'info', 'debug', 'silly', 'trace'].forEach((lvl) => {
    l[lvl] = (...args: unknown[]) => {
      process.stderr.write(`[MY LOG] ${args.map(maskLogText).join(' ')}\n`);
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
  if (!overrides || Object.keys(overrides).length === 0) {
    return;
  }
  assertSafeProductionOverrides(overrides);
  if (isStdioMode) {
    return;
  }
  userOverrides = { ...userOverrides, ...overrides };
  realMain = null;
  realFile = undefined;
  subCache.clear();
}

export { logger, fileLogger, useFileLogger };
