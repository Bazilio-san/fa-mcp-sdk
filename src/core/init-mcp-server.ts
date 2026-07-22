import { closeAllPgConnectionsPg } from 'af-db-ts';
import chalk from 'chalk';
import { AccessPoints, IAccessPoints, IRegisterCyclic, IAccessPoint } from 'fa-consul';

import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { McpServerData } from './_types_/types.js';
import { dotEnvResult } from './bootstrap/dotenv.js';
import { appConfig } from './bootstrap/init-config.js';
import { assertHttpAuthPreflight, assertProductionSurfaceSecurity } from './bootstrap/production-preflight.js';
import { startupInfo } from './bootstrap/startup-info.js';
import { accessPointUpdater } from './consul/access-points-updater.js';
import { registerCyclic } from './consul/register.js';
import { checkMainDB } from './db/pg-db.js';
import { logInternalError } from './errors/errors.js';
import { applyLoggerSettings, fileLogger, logger as lgr } from './logger.js';

// Imports to modify _core functions
import { initDebugTraceFromConfig } from './mcp/debug-trace.js';
import { assertStaticRequiredScopes, isValidScope } from './mcp/required-scopes.js';
import { startStdioServer } from './mcp/server-stdio.js';
import { assertToolSchemas } from './mcp/validate-tool-args.js';
import { assertToolAliases, assertToolNames } from './mcp/validate-tool-names.js';
import { wrapProjectDataWithDebug } from './mcp/wrap-project-data-with-debug.js';
import { checkPortAvailability } from './utils/port-checker.js';
import { isNonEmptyObject } from './utils/utils.js';
import { startHttpServer } from './web/server-http.js';

let cyclicRegisterServiceInConsul: IRegisterCyclic;
const initCyclicRegisterServiceInConsul = async () => {
  if (appConfig.consul.service.enable) {
    // Starting a cyclic service registration in consul
    cyclicRegisterServiceInConsul = await registerCyclic();
    await cyclicRegisterServiceInConsul.start();
  }
};

const initAccessPoints = () => {
  if (!isNonEmptyObject(appConfig.accessPoints)) {
    return;
  }
  const accessPoints = { ...appConfig.accessPoints };
  const logger = lgr.getSubLogger({ name: chalk.magenta('accessPoints') });
  appConfig.accessPoints = new AccessPoints(accessPoints, logger) as unknown as IAccessPoints;
  Object.entries(accessPoints).forEach(([accessPointKey, value]) => {
    if (!appConfig.accessPoints[accessPointKey]) {
      appConfig.accessPoints[accessPointKey] = value as IAccessPoint;
    }
  });
  accessPointUpdater.start();
};

export async function gracefulShutdown(signal: string, exitCode: number = 0) {
  console.error(`A ${signal} signal has been received. Complete...`);
  const FORCE_EXIT_TIMEOUT_MS = 5_000;
  const forceTimer = setTimeout(() => {
    console.error('Timeout 10s. Hard finish.');
    process.exit(1);
  }, FORCE_EXIT_TIMEOUT_MS);
  // To prevent the timer from holding the event
  forceTimer.unref?.();

  try {
    if (cyclicRegisterServiceInConsul?.stop) {
      cyclicRegisterServiceInConsul.stop();
    }
    if (appConfig.isMainDBUsed) {
      console.error('Closing database connections...');
      await closeAllPgConnectionsPg();
      console.error('Connections successfully closed');
    }
    if (fileLogger?.asyncFinish) {
      await fileLogger.asyncFinish();
    }
    accessPointUpdater.stop();

    process.exit(exitCode);
  } catch (error) {
    logInternalError(error, 'shutdown');
    process.exit(1);
  }
}

/**
 * The main function of MCP server initialization
 * Accepts all design data and starts the server
 */
export async function initMcpServer(data: McpServerData): Promise<void> {
  // Apply user-provided logger overrides before any further logger usage in this call.
  // Subloggers created at module-import time will pick up the new settings on next access
  // because they are resolved lazily through proxies in logger.ts.
  if (data.loggerSettings) {
    applyLoggerSettings(data.loggerSettings);
  }

  const needCheckDb = process.env.NODE_ENV !== 'test' && appConfig.isMainDBUsed;

  // Handle graceful shutdown
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // Open the JSON-lines debug sink before any traffic flows (no-op when unset)
  initDebugTraceFromConfig();

  // Standard §9.1 — eagerly validate static tool names so a misconfigured project fails fast.
  // Dynamic (function-form) tools are validated lazily in getTools() on first call.
  if (Array.isArray(data.tools)) {
    assertToolNames(data.tools as Tool[]);
    assertToolSchemas(data.tools as Tool[]);
    assertToolAliases(data.tools as Tool[], data.toolAliases);
  }
  assertStaticRequiredScopes(data);
  if (data.readinessChecks) {
    const reserved = new Set(['db', 'cache', 'jwks']);
    for (const [name, check] of Object.entries(data.readinessChecks)) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(name) || reserved.has(name) || typeof check !== 'function') {
        throw new Error(
          `Invalid readinessChecks entry "${name}": use a unique snake_case name and a function returning readiness.`,
        );
      }
    }
  }
  if (
    data.defaultReadScopes !== undefined &&
    (!Array.isArray(data.defaultReadScopes) ||
      data.defaultReadScopes.length === 0 ||
      data.defaultReadScopes.some((scope) => !isValidScope(scope)) ||
      new Set(data.defaultReadScopes).size !== data.defaultReadScopes.length)
  ) {
    throw new Error('McpServerData.defaultReadScopes must be a non-empty array of unique valid OAuth scopes.');
  }

  // Temporarily store data in a global context for access from _core functions
  global.__MCP_PROJECT_DATA__ = wrapProjectDataWithDebug(data);

  const { transportType } = appConfig.mcp;

  switch (transportType) {
    case 'stdio':
      // Test database connection on startup (skip in test mode)
      if (needCheckDb) {
        await checkMainDB();
      }
      await startStdioServer();
      break;

    case 'http': {
      // Standard §6: production refuses an empty `originHosts` (which would degrade CORS to
      // "allow everything"). Dev / test workflows keep working — the check fires only when
      // NODE_ENV resolves to `production`.
      const isProd = (process.env.NODE_CONSUL_ENV || process.env.NODE_ENV) === 'production';
      const { originHosts } = appConfig.webServer;
      if (
        isProd &&
        (!Array.isArray(originHosts) ||
          originHosts.length === 0 ||
          originHosts.some((origin) => !String(origin).trim() || String(origin).includes('*')))
      ) {
        throw new Error(
          'webServer.originHosts must contain only explicit allowed origins/hosts in production. ' +
            'Empty entries and "*" are forbidden.',
        );
      }
      if (!isProd && (!Array.isArray(originHosts) || originHosts.length === 0)) {
        lgr.warn('webServer.originHosts is empty — CORS will reject every cross-origin request.');
      }

      // Standard Прил. A.1 / §7.2 — JWT mode pre-flight checks.
      // Fail fast on misconfigured non-legacy modes so a server with broken auth never starts.
      const auth = appConfig.webServer?.auth;
      assertHttpAuthPreflight(auth, isProd);
      assertProductionSurfaceSecurity(appConfig, isProd);

      await startupInfo({ dotEnvResult, customStartupInfo: data.customStartupInfo });

      // Check if port is available before proceeding
      await checkPortAvailability(appConfig.webServer.port, appConfig.webServer.host, true);

      if (needCheckDb) {
        await checkMainDB();
      }
      await startHttpServer();
      // Starting a cyclic service registration in consul
      await initCyclicRegisterServiceInConsul();
      initAccessPoints();

      break;
    }

    default:
      throw new Error(`Unsupported transport type: ${transportType}`);
  }
}
