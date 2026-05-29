/**
 * Standard §15.2 + §8.2 — MCP `logging` capability surface.
 *
 * Each `Server` instance keeps its own minimum severity (Syslog-style ladder: `debug` is the
 * loosest, `emergency` the tightest). Clients change it via `logging/setLevel`. The SDK then
 * uses {@link sendLoggingMessage} to emit `notifications/message` events for every entry that
 * meets the threshold.
 *
 * The capability is opt-out via `mcp.logging.enabled = false` (default `true`) — useful for
 * compatibility tests against clients that don't understand notifications.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SetLevelRequestSchema, type LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

import { appConfig } from '../bootstrap/init-config.js';

const LEVEL_ORDER: Record<LoggingLevel, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
};

const DEFAULT_MAX_BODY_BYTES = 4096;

const minLevelByServer = new WeakMap<Server, LoggingLevel>();

function getMaxBodyBytes(): number {
  const cfg = (appConfig.mcp as { logging?: { maxBodyBytes?: number } }).logging?.maxBodyBytes;
  return typeof cfg === 'number' && cfg > 0 ? cfg : DEFAULT_MAX_BODY_BYTES;
}

function getConfiguredDefault(): LoggingLevel {
  const cfg = (appConfig.mcp as { logging?: { defaultLevel?: LoggingLevel } }).logging?.defaultLevel;
  return cfg && cfg in LEVEL_ORDER ? cfg : 'info';
}

export function getMcpLoggingLevel(server: Server): LoggingLevel {
  return minLevelByServer.get(server) ?? getConfiguredDefault();
}

export function setMcpLoggingLevel(server: Server, level: LoggingLevel): void {
  if (!(level in LEVEL_ORDER)) {
    throw new Error(`Invalid logging level: ${level}`);
  }
  minLevelByServer.set(server, level);
}

/**
 * Returns true when the supplied event severity is at or above the server's current minimum.
 */
export function shouldEmitLogging(server: Server, level: LoggingLevel): boolean {
  const min = getMcpLoggingLevel(server);
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}

function truncate(value: unknown, maxBytes: number): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  let json: string;
  try {
    json = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (json.length <= maxBytes) {
    return value;
  }
  return `${json.slice(0, maxBytes)}…[truncated ${json.length - maxBytes} chars]`;
}

/**
 * Emit a single `notifications/message`. Silently dropped when the capability is disabled
 * or the supplied level is below the per-server threshold.
 *
 * `logger` lets the caller tag the source (e.g. `tool:my_tool`); MCP clients can route on it.
 */
export async function sendLoggingMessage(
  server: Server,
  level: LoggingLevel,
  data: unknown,
  logger?: string,
): Promise<void> {
  if (appConfig.mcp.logging?.enabled === false) {
    return;
  }
  if (!shouldEmitLogging(server, level)) {
    return;
  }
  const params: Record<string, unknown> = {
    level,
    data: truncate(data, getMaxBodyBytes()),
  };
  if (logger) {
    params.logger = logger;
  }
  try {
    await server.notification({ method: 'notifications/message', params });
  } catch {
    // Notifications are best-effort — never break a request flow because logging failed.
  }
}

/**
 * Register the `logging/setLevel` handler on a server. Capability declaration happens in
 * `createMcpServer` (must be set at construction time per SDK contract).
 */
export function registerLoggingCapability(server: Server): void {
  if (appConfig.mcp.logging?.enabled === false) {
    return;
  }
  setMcpLoggingLevel(server, getConfiguredDefault());
  server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    const level = request.params.level as LoggingLevel;
    setMcpLoggingLevel(server, level);
    return {};
  });
}
