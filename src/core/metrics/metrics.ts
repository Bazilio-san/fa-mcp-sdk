/**
 * Standard §15.3 — Prometheus exposition for MCP-server operability.
 *
 * Off by default; enabled via `webServer.metrics.enabled = true`. When active, a single
 * `prom-client` registry holds every series the SDK emits. Process-level metrics (GC, heap,
 * uptime) are added conditionally — they add ≈30 series, so projects scraping multiple SDK
 * instances can shed them by setting `webServer.metrics.includeProcessMetrics = false`.
 *
 * All metrics use snake_case names; cardinality is bounded by tool name / status so the
 * SDK never explodes a Prometheus instance even when run with hundreds of tools.
 */
import { collectDefaultMetrics, Counter, Gauge, Histogram, register, Registry } from 'prom-client';

import { appConfig } from '../bootstrap/init-config.js';

let registry: Registry | undefined;
let initialized = false;

export interface IMcpMetrics {
  toolCalls: Counter<'tool' | 'status'>;
  toolDuration: Histogram<'tool'>;
  authFailures: Counter<'reason'>;
  rateLimitHits: Counter<'scope'>;
  httpRequests: Counter<'method' | 'path' | 'status'>;
  concurrentCalls: Gauge<never>;
  payloadBytes: Histogram<never>;
  resultBytes: Histogram<never>;
  /** Standard §8.7 — task lifecycle transitions by status (created/completed/failed/cancelled). */
  tasks: Counter<'status'>;
}

let metrics: IMcpMetrics | undefined;

const DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
const BYTES_BUCKETS = [256, 1024, 4096, 16_384, 65_536, 262_144, 1_048_576, 10_485_760];

export type ToolCallStatus =
  | 'ok'
  | 'error'
  | 'forbidden'
  | 'timeout'
  | 'rate_limited'
  | 'invalid_params'
  | 'internal_error';

export type RateLimitScope = 'subject' | 'ip' | 'concurrent';

function ensureRegistry(): Registry {
  if (registry) {
    return registry;
  }
  registry = new Registry();
  return registry;
}

/**
 * Lazy initialization — `initMetrics` is called from `server-http.ts` only when metrics are
 * enabled. Subsequent calls are no-ops, so tests can re-import without leaking series.
 */
export function initMetrics(): IMcpMetrics {
  if (metrics) {
    return metrics;
  }
  const reg = ensureRegistry();

  if (appConfig.webServer.metrics?.includeProcessMetrics !== false) {
    collectDefaultMetrics({ register: reg });
  }

  metrics = {
    toolCalls: new Counter({
      name: 'mcp_tool_calls_total',
      help: 'Number of MCP tools/call invocations by tool name and final status.',
      labelNames: ['tool', 'status'] as const,
      registers: [reg],
    }),
    toolDuration: new Histogram({
      name: 'mcp_tool_duration_seconds',
      help: 'Wall-clock duration of MCP tools/call invocations.',
      labelNames: ['tool'] as const,
      buckets: DURATION_BUCKETS,
      registers: [reg],
    }),
    authFailures: new Counter({
      name: 'mcp_auth_failures_total',
      help: 'Number of authentication failures by reason.',
      labelNames: ['reason'] as const,
      registers: [reg],
    }),
    rateLimitHits: new Counter({
      name: 'mcp_rate_limit_hits_total',
      help: 'Number of rate-limit rejections by enforcement scope.',
      labelNames: ['scope'] as const,
      registers: [reg],
    }),
    httpRequests: new Counter({
      name: 'mcp_http_requests_total',
      help: 'Number of HTTP requests by method, route and final status code.',
      labelNames: ['method', 'path', 'status'] as const,
      registers: [reg],
    }),
    concurrentCalls: new Gauge({
      name: 'mcp_concurrent_calls',
      help: 'Aggregate number of in-flight MCP tools/call invocations in this process.',
      registers: [reg],
    }),
    payloadBytes: new Histogram({
      name: 'mcp_payload_bytes',
      help: 'Size of incoming MCP request payloads in bytes.',
      buckets: BYTES_BUCKETS,
      registers: [reg],
    }),
    resultBytes: new Histogram({
      name: 'mcp_result_bytes',
      help: 'Size of serialized MCP tool results in bytes.',
      buckets: BYTES_BUCKETS,
      registers: [reg],
    }),
    tasks: new Counter({
      name: 'mcp_tasks_total',
      help: 'Number of task lifecycle transitions by status.',
      labelNames: ['status'] as const,
      registers: [reg],
    }),
  };
  initialized = true;
  return metrics;
}

/**
 * Safe accessor for places that may run before `initMetrics` (e.g. tool execution paths that
 * run regardless of HTTP / stdio mode). Returns `undefined` when metrics are disabled — call
 * sites should use optional chaining: `getMetrics()?.toolCalls.inc(...)`.
 */
export function getMetrics(): IMcpMetrics | undefined {
  return metrics;
}

export function isMetricsEnabled(): boolean {
  return initialized && appConfig.webServer.metrics?.enabled === true;
}

export function getMetricsRegistry(): Registry {
  return ensureRegistry();
}

/**
 * The default global `register` is left alone so apps that already export their own metrics
 * via prom-client keep working. The SDK only writes to its private registry.
 */
export function getGlobalPromRegister(): Registry {
  return register;
}
