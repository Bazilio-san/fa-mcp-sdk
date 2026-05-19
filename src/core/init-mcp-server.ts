import { closeAllPgConnectionsPg } from 'af-db-ts';
import chalk from 'chalk';
import { AccessPoints, IAccessPoints, IRegisterCyclic, IAccessPoint } from 'fa-consul';

import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { ITransportContext, IToolHandlerParams, McpServerData, TToolHandlerResponse } from './_types_/types.js';
import { dotEnvResult } from './bootstrap/dotenv.js';
import { appConfig } from './bootstrap/init-config.js';
import { startupInfo } from './bootstrap/startup-info.js';
import { accessPointUpdater } from './consul/access-points-updater.js';
import { registerCyclic } from './consul/register.js';
import { debugMcpTool } from './debug.js';
import { checkMainDB } from './db/pg-db.js';
import { applyLoggerSettings, fileLogger, logger as lgr } from './logger.js';

// Imports to modify _core functions
import { BUILTIN_MCP_DEBUG_TOOLS, handleBuiltinDebugTool, isBuiltinDebugTool } from './mcp/builtin-debug-tools.js';
import { emitTrace, initDebugTraceFromConfig, makeCorr } from './mcp/debug-trace.js';
import { startStdioServer } from './mcp/server-stdio.js';
import { checkPortAvailability } from './utils/port-checker.js';
import { DEBUG_TOOL, DEBUG_TOOL_NAME, handleDebugTool } from './utils/testing/debug-tool.js';
import { isNonEmptyObject } from './utils/utils.js';
import { startHttpServer } from './web/server-http.js';

/**
 * Render a tool response in human-readable form for the DEBUG=mcp:tool stream.
 * Text-content responses are dumped as their `text`; structuredContent and any other
 * shape is pretty-printed JSON.
 */
function formatToolResponseForDebug(res: any): string {
  if (res?.content?.[0]?.text != null) {
    return String(res.content[0].text);
  }
  try {
    return JSON.stringify(res, null, 2);
  } catch {
    return String(res);
  }
}

/**
 * Decorate `data.toolHandler` so every tool call emits a request/response pair on the
 * DEBUG=mcp:tool stream. Both HTTP and STDIO transports resolve the handler through the
 * same `global.__MCP_PROJECT_DATA__`, so wrapping here covers all transports at once.
 *
 * When `appConfig.mcp.debug.builtinTools` is true, SDK-provided helper tools
 * (`mcp-debug-log`, `mcp-debug-refresh`, `debug-tool`) are appended to the
 * tool list and routed to their built-in handlers — never delegated to the
 * user-supplied `toolHandler`. They carry `_meta.ui.visibility: ['app']` so
 * MCP App hosts hide them from the LLM.
 */
function wrapProjectDataWithDebug(data: McpServerData): McpServerData {
  const builtinEnabled = appConfig.mcp?.debug?.builtinTools === true;
  const originalToolHandler = data.toolHandler;
  const wrappedToolHandler = async <T = unknown>(params: IToolHandlerParams): Promise<TToolHandlerResponse<T>> => {
    const { name, arguments: args } = params;
    const corr = makeCorr();
    const startedAt = Date.now();
    if (debugMcpTool.enabled) {
      debugMcpTool(`→ tool/call ${name}\n${JSON.stringify(args ?? {}, null, 2)}`);
    }
    emitTrace('mcp:tool', { kind: 'req', name, args: args ?? {}, corr });
    try {
      let result: TToolHandlerResponse<T>;
      if (builtinEnabled && isBuiltinDebugTool(name)) {
        result = (await handleBuiltinDebugTool(params)) as TToolHandlerResponse<T>;
      } else if (builtinEnabled && name === DEBUG_TOOL_NAME) {
        result = (await handleDebugTool(params)) as TToolHandlerResponse<T>;
      } else {
        result = await originalToolHandler<T>(params);
      }
      const ms = Date.now() - startedAt;
      if (debugMcpTool.enabled) {
        debugMcpTool(`← tool/call ${name}\n${formatToolResponseForDebug(result)}`);
      }
      emitTrace('mcp:tool', { kind: 'res', name, ms, corr, ok: true });
      return result;
    } catch (error: any) {
      const ms = Date.now() - startedAt;
      const errMsg = error?.message || String(error);
      if (debugMcpTool.enabled) {
        debugMcpTool(`✗ tool/call ${name} threw: ${errMsg}`);
      }
      emitTrace('mcp:tool', { kind: 'err', name, ms, corr, error: errMsg });
      throw error;
    }
  };

  // Append built-in tools to the user's tool list (preserving array vs. function form).
  let wrappedTools: McpServerData['tools'] = data.tools;
  if (builtinEnabled) {
    const builtins: Tool[] = [...BUILTIN_MCP_DEBUG_TOOLS, DEBUG_TOOL];
    const original = data.tools;
    if (typeof original === 'function') {
      wrappedTools = async (ctx: ITransportContext) => [...(await original(ctx)), ...builtins];
    } else {
      wrappedTools = [...(original as Tool[]), ...builtins];
    }
  }

  return { ...data, tools: wrappedTools, toolHandler: wrappedToolHandler };
}

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
    console.error('Error when closing connections:', error);
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
