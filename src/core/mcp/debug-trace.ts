/**
 * JSON-lines debug sink for MCP server traffic.
 *
 * Stderr output via `DEBUG=mcp:*` (`af-tools-ts/Debug`) is great for live
 * development but useless for post-mortem analysis: ANSI colors, multi-process
 * interleaving, no structured fields. This module mirrors every `debugMcp*`
 * stream into a single newline-delimited JSON file when `mcp.debug.logFile`
 * is configured. Stderr behavior is unchanged — the sink is purely additive.
 *
 * Activation:
 *   - via `appConfig.mcp.debug.logFile` (absolute path) — set the file path
 *     at startup and call {@link initDebugTraceFromConfig}; or
 *   - via {@link configureDebugSink} for programmatic control (tests).
 *
 * Each event is one line like:
 *   {"ts":"2026-05-19T12:34:56.124Z","ch":"mcp:tool","kind":"req","name":"get_rate","corr":"a3f1",...}
 *
 * No-op when no sink is configured — call sites are cheap (one `if`).
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { appConfig } from '../bootstrap/init-config.js';
import { logger } from '../logger.js';
import { getCurrentRequestContext } from '../web/request-id.js';

type Sink = (event: Record<string, unknown>) => void;

let sink: Sink | null = null;
const operationLogger = logger.getSubLogger({ name: 'mcp-operation' });

export function traceDigest(value: unknown): string {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

/** Return only a bounded machine identifier suitable for operational logs; human/PII-like names stay hashed. */
export function safeTraceDescriptorName(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{1,63}$/.test(value) ? value : undefined;
}

export function traceValueShape(value: unknown): Record<string, unknown> {
  if (value === null) {
    return { type: 'null' };
  }
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length };
  }
  if (typeof value === 'object') {
    return { type: 'object', keyCount: Object.keys(value as object).length };
  }
  if (typeof value === 'string') {
    return { type: 'string', chars: value.length };
  }
  return { type: typeof value };
}

/**
 * Configure (or disable) the JSON-lines sink.
 *
 * @param logFile Absolute path to the .jsonl file. Empty / undefined disables the sink.
 *
 * Writes are fire-and-forget: failures (permission, disk full) are swallowed
 * so debug logging never breaks the server. The parent directory is created
 * lazily on the first event.
 */
export function configureDebugSink(logFile: string | undefined | null): void {
  if (!logFile || typeof logFile !== 'string' || logFile.trim() === '') {
    sink = null;
    return;
  }
  const resolved = path.resolve(logFile.trim());
  let dirEnsured = false;
  sink = (event) => {
    const line = JSON.stringify(event) + '\n';
    const write = () => appendFile(resolved, line, 'utf-8').catch(() => {});
    if (dirEnsured) {
      void write();
      return;
    }
    void mkdir(path.dirname(resolved), { recursive: true })
      .catch(() => {})
      .then(() => {
        dirEnsured = true;
        return write();
      });
  };
}

/**
 * Emit a single trace event. Always adds `ts` (ISO timestamp), `ch` (channel),
 * plus correlation fields drawn from {@link getCurrentRequestContext} so
 * post-mortem analysis can stitch together every event of a request.
 * No-op when the sink is not configured.
 */
export function emitTrace(channel: string, event: Record<string, unknown>): void {
  const reqCtx = getCurrentRequestContext();
  const corr: Record<string, unknown> = {};
  if (reqCtx?.requestId) {
    corr.requestId = reqCtx.requestId;
  }
  if (reqCtx?.jsonRpcId !== undefined && reqCtx?.jsonRpcId !== null) {
    corr.jsonRpcIdType = typeof reqCtx.jsonRpcId;
    corr.jsonRpcIdHash = traceDigest(reqCtx.jsonRpcId);
  }
  if (reqCtx?.traceContext) {
    corr.traceId = reqCtx.traceContext.traceId;
    corr.spanId = reqCtx.traceContext.parentId;
  }
  const kind = typeof event.kind === 'string' ? event.kind : '';
  const isCompletion = kind === 'res' || kind === 'err' || kind.endsWith('-res') || kind.endsWith('-err');
  if (isCompletion) {
    const explicitStatus = event.status === 'success' || event.status === 'error' ? event.status : undefined;
    const status =
      explicitStatus ?? (kind === 'err' || kind.endsWith('-err') || event.ok === false ? 'error' : 'success');
    const descriptorHash = typeof event.descriptorHash === 'string' ? event.descriptorHash : undefined;
    operationLogger.info('MCP operation completed', {
      operation: channel,
      name: typeof event.name === 'string' ? event.name : descriptorHash ? `sha256:${descriptorHash}` : '*',
      ...(typeof event.nameHash === 'string' ? { nameHash: event.nameHash } : {}),
      ...(descriptorHash ? { descriptorHash } : {}),
      ...(typeof event.uriHash === 'string' ? { uriHash: event.uriHash } : {}),
      requestId: reqCtx?.requestId ?? null,
      traceId: reqCtx?.traceContext?.traceId ?? null,
      spanId: reqCtx?.traceContext?.parentId ?? null,
      durationMs: typeof event.ms === 'number' ? event.ms : null,
      status,
    });
  }
  if (!sink) {
    return;
  }
  sink({ ts: new Date().toISOString(), ch: channel, ...corr, ...event });
}

/**
 * Generate a short correlation ID for matching req/res/err events of a single call.
 * 8 hex chars — collision-resistant enough for human reading; not cryptographic.
 */
export function makeCorr(): string {
  return Math.random().toString(16).slice(2, 10).padStart(8, '0');
}

/**
 * Initialize the sink from `appConfig.mcp.debug.logFile`. Called once at server
 * startup; safe to call again to apply config changes during tests.
 */
export function initDebugTraceFromConfig(): void {
  configureDebugSink(appConfig.mcp?.debug?.logFile);
}
