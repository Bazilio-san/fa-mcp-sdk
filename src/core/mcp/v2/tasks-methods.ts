import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { IClientCapabilities, IToolHandlerParams, TToolHandlerResponse } from '../../_types_/types.js';
import { appConfig } from '../../bootstrap/init-config.js';
import { sanitizeOutwardMessage } from '../../errors/errors.js';
import { getMetrics } from '../../metrics/metrics.js';
import { getTaskStore, isTerminalTaskStatus, toTaskDto } from '../task-store.js';
import type { ITaskRecord } from '../task-store.js';
import { isInputRequiredResponse } from './mrtr.js';

/**
 * The official Tasks extension (`io.modelcontextprotocol/tasks`) for the modern (2026-07-28) era.
 * The v2 package ships the wire schemas but no server-side mechanics, so this module provides
 * them over our `task-store`: unsolicited `CreateTaskResult` from `tools/call` (only toward
 * clients that declared the extension), polling via `tasks/get`, mid-flight input via
 * `tasks/update` (MRTR re-entry into the same tool handler), and cooperative `tasks/cancel`.
 * `tasks/list` is not part of the extension and is not registered.
 */

export const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';

export const clientDeclaredTasksExtension = (caps: IClientCapabilities | undefined): boolean =>
  Boolean((caps as { extensions?: Record<string, unknown> } | undefined)?.extensions?.[TASKS_EXTENSION_ID]);

/** MRTR bookkeeping a task carries between `input_required` and the `tasks/update` re-entry. */
interface ITaskMrtrState {
  inputRequests?: Record<string, { method: string; params?: Record<string, unknown> }>;
  state?: unknown;
}
const mrtrByTask = new Map<string, ITaskMrtrState>();

type TRunToolCall = (
  extra: Pick<IToolHandlerParams, 'signal' | 'inputResponses' | 'requestStatePayload'>,
) => Promise<TToolHandlerResponse | unknown>;
const runnerByTask = new Map<string, TRunToolCall>();

const settleRound = (record: ITaskRecord, raw: unknown): void => {
  const store = getTaskStore();
  if (store.get(record.taskId)?.status !== 'working') {
    return; // cancelled while the handler was running
  }
  if (isInputRequiredResponse(raw)) {
    mrtrByTask.set(record.taskId, {
      ...(raw.inputRequests ? { inputRequests: raw.inputRequests } : {}),
      state: raw.state,
    });
    store.update(record.taskId, { status: 'input_required' });
    return;
  }
  mrtrByTask.delete(record.taskId);
  runnerByTask.delete(record.taskId);
  store.update(record.taskId, { status: 'completed', result: raw as ITaskRecord['result'] });
  getMetrics()?.tasks.inc({ status: 'completed' });
};

const runRound = (record: ITaskRecord, inputResponses?: Record<string, unknown>): void => {
  const store = getTaskStore();
  const runner = runnerByTask.get(record.taskId);
  if (!runner) {
    return;
  }
  const mrtr = mrtrByTask.get(record.taskId);
  void (async () => {
    try {
      const raw = await runner({
        signal: record.abort.signal,
        ...(inputResponses ? { inputResponses } : {}),
        ...(mrtr?.state !== undefined ? { requestStatePayload: mrtr.state } : {}),
      });
      settleRound(record, raw);
    } catch (error) {
      if (store.get(record.taskId)?.status === 'working') {
        store.update(record.taskId, { status: 'failed', statusMessage: sanitizeOutwardMessage(error) });
        getMetrics()?.tasks.inc({ status: 'failed' });
      }
      mrtrByTask.delete(record.taskId);
      runnerByTask.delete(record.taskId);
    }
  })();
};

/**
 * Decide whether this modern `tools/call` becomes a task. Yes when the tasks feature is enabled,
 * the client declared the extension, and the tool opted in (`execution.taskSupport` `optional` |
 * `required`). Returns the `CreateTaskResult` (`resultType: "task"`) or undefined for the
 * synchronous path. Never returns a task to a client that did not declare the extension.
 */
export const maybeStartModernTask = (options: {
  tool: Tool;
  caps: IClientCapabilities | undefined;
  subjectKey: string;
  runToolCall: TRunToolCall;
}): { resultType: 'task'; task: ReturnType<typeof toTaskDto>; content: never[] } | undefined => {
  const { tool, caps, subjectKey, runToolCall } = options;
  if (!clientDeclaredTasksExtension(caps)) {
    return undefined;
  }
  const support = (tool as { execution?: { taskSupport?: string } }).execution?.taskSupport ?? 'forbidden';
  if (support !== 'optional' && support !== 'required') {
    return undefined;
  }
  const store = getTaskStore();
  const record = store.create({ method: 'tools/call', toolName: tool.name, subjectKey });
  getMetrics()?.tasks.inc({ status: 'created' });
  runnerByTask.set(record.taskId, runToolCall);
  runRound(record);
  // `content: []` satisfies the v2 wire schema for tools/call results; extension-aware clients
  // dispatch on `resultType: "task"` and read `task`.
  return { resultType: 'task', task: toTaskDto(record, store.pollIntervalMs), content: [] };
};

export const MODERN_TASK_METHODS = new Set(['tasks/get', 'tasks/update', 'tasks/cancel']);

interface IJsonRpcShape {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: { taskId?: unknown; inputResponses?: unknown; _meta?: Record<string, unknown> };
}

const ok = (id: IJsonRpcShape['id'], result: Record<string, unknown>) => ({
  status: 200,
  json: {
    jsonrpc: '2.0' as const,
    id: id ?? null,
    result: {
      ...result,
      resultType: 'complete',
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: appConfig.name, version: appConfig.version } },
    },
  },
});

const rpcError = (id: IJsonRpcShape['id'], status: number, code: number, message: string, data?: unknown) => ({
  status,
  json: { jsonrpc: '2.0' as const, id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } },
});

/**
 * HTTP-layer handler for the extension's methods. The v2 package's 2026 codec hard-rejects the
 * `tasks/*` spec methods with `-32601` before any registered handler runs (its deleted-method
 * registry is closed), so a dual-era server serves the EXTENSION's methods in front of the v2
 * handler. Returns undefined when the request is not a modern tasks-extension call (the caller
 * then falls through to the v2 handler).
 */
export const handleModernTaskMethod = (
  body: unknown,
  authPayload: Record<string, unknown> | undefined,
): { status: number; json: Record<string, unknown> } | undefined => {
  const req = body as IJsonRpcShape;
  if (!req || typeof req !== 'object' || !MODERN_TASK_METHODS.has(req.method ?? '')) {
    return undefined;
  }
  const meta = req.params?._meta;
  if (!meta?.['io.modelcontextprotocol/protocolVersion']) {
    return undefined; // not a modern envelope — let the v2 handler answer per its era rules
  }
  const { id } = req;
  const caps = meta['io.modelcontextprotocol/clientCapabilities'] as IClientCapabilities | undefined;
  if (caps === undefined) {
    return rpcError(id, 400, -32_602, 'Invalid _meta envelope: io.modelcontextprotocol/clientCapabilities: missing');
  }
  if (appConfig.mcp.tasks?.enabled !== true || !clientDeclaredTasksExtension(caps)) {
    // Extension not active for this pair — the method does not exist.
    return rpcError(id, 404, -32_601, 'Method not found');
  }
  const taskId = req.params?.taskId;
  if (typeof taskId !== 'string' || !taskId) {
    return rpcError(id, 400, -32_602, 'Invalid params: taskId: required string', {
      field: 'taskId',
      reason: 'required',
    });
  }
  const store = getTaskStore();
  const subjectKey = subjectKeyOf(authPayload);
  const record = store.get(taskId);
  if (!record || record.subjectKey !== subjectKey) {
    // Same answer for "not found" and "foreign task" — no existence oracle across subjects.
    return rpcError(id, 400, -32_602, 'Unknown task', { field: 'taskId', reason: 'unknown_task' });
  }

  if (req.method === 'tasks/get') {
    const mrtr = mrtrByTask.get(record.taskId);
    return ok(id, {
      ...toTaskDto(record, store.pollIntervalMs),
      ...(record.status === 'input_required' && mrtr?.inputRequests ? { inputRequests: mrtr.inputRequests } : {}),
      ...(record.status === 'completed' && record.result !== undefined ? { result: record.result } : {}),
      ...(record.status === 'failed'
        ? { error: { code: -32_603, message: record.statusMessage ?? 'Task failed' } }
        : {}),
    });
  }

  if (req.method === 'tasks/update') {
    if (record.status !== 'input_required') {
      return rpcError(id, 400, -32_602, 'Task is not awaiting input', {
        field: 'taskId',
        reason: 'task_not_input_required',
      });
    }
    store.update(record.taskId, { status: 'working' });
    runRound(record, (req.params?.inputResponses as Record<string, unknown> | undefined) ?? undefined);
    return ok(id, {});
  }

  // tasks/cancel
  const wasActive = !isTerminalTaskStatus(record.status);
  const updated = store.cancel(record.taskId) ?? record;
  if (wasActive && updated.status === 'cancelled') {
    getMetrics()?.tasks.inc({ status: 'cancelled' });
    mrtrByTask.delete(record.taskId);
    runnerByTask.delete(record.taskId);
  }
  return ok(id, { ...toTaskDto(updated, store.pollIntervalMs) });
};

const subjectKeyOf = (payload: Record<string, unknown> | undefined): string => {
  const sub = payload?.sub ?? payload?.user;
  return typeof sub === 'string' && sub.trim() ? sub.trim().toLowerCase() : 'anonymous';
};
