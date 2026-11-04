import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { classifyInboundRequest, isSpecType, ProtocolError } from '@modelcontextprotocol/server';

import { IClientCapabilities, IToolHandlerParams, TToolHandlerResponse } from '../../_types_/types.js';
import { appConfig } from '../../bootstrap/init-config.js';
import { toMcpError } from '../../errors/errors.js';
import { getMetrics } from '../../metrics/metrics.js';
import { getTaskStore, isTerminalTaskStatus, toTaskDto } from '../task-store.js';
import type { ITaskRecord } from '../task-store.js';
import { isInputRequiredResponse, missingCapabilitiesForInputRequests } from './mrtr.js';

/**
 * The official Tasks extension (`io.modelcontextprotocol/tasks`) for the modern (2026-07-28) era.
 * The v2 package's task schemas describe the legacy extension; this module implements the
 * modern extension over our `task-store`: unsolicited `CreateTaskResult` from `tools/call` (only toward
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
  usedKeys: Set<string>;
  caps: IClientCapabilities | undefined;
}
const mrtrByTask = new WeakMap<ITaskRecord, ITaskMrtrState>();

type TRunToolCall = (
  extra: Pick<IToolHandlerParams, 'signal' | 'inputResponses' | 'requestStatePayload'>,
) => Promise<TToolHandlerResponse | unknown>;
const runnerByTask = new WeakMap<ITaskRecord, TRunToolCall>();

export const toModernTaskDto = (record: ITaskRecord, pollIntervalMs: number) => {
  const { ttl, pollInterval, ...rest } = toTaskDto(record, pollIntervalMs);
  return { ...rest, ttlMs: ttl, pollIntervalMs: pollInterval };
};

const resultMeta = () => ({
  'io.modelcontextprotocol/serverInfo': { name: appConfig.name, version: appConfig.version },
});

const safeTaskError = (error: unknown) => {
  const mapped = error instanceof ProtocolError || error instanceof McpError ? error : toMcpError(error);
  const data =
    mapped.data && typeof mapped.data === 'object'
      ? Object.fromEntries(
          Object.entries(mapped.data).filter(
            ([key, value]) =>
              ['field', 'reason', 'requestId', 'retryAfter'].includes(key) &&
              (typeof value === 'string' || typeof value === 'number'),
          ),
        )
      : undefined;
  return {
    code: mapped.code,
    message: mapped.message.replace(/^MCP error -?\d+: /, ''),
    ...(data && Object.keys(data).length ? { data } : {}),
  };
};

const settleRound = (record: ITaskRecord, raw: unknown): void => {
  const store = getTaskStore();
  if (store.get(record.taskId)?.status !== 'working') {
    return; // cancelled while the handler was running
  }
  if (isInputRequiredResponse(raw)) {
    const previous = mrtrByTask.get(record)!;
    const keys = Object.keys(raw.inputRequests ?? {});
    if (!keys.length || keys.some((key) => previous.usedKeys.has(key))) {
      throw new ProtocolError(-32603, 'Task input request keys must be nonempty and unique over the task lifetime');
    }
    const missing = missingCapabilitiesForInputRequests(raw.inputRequests, previous.caps);
    if (missing.length) {
      throw new ProtocolError(-32021, 'Client does not support the requested task input');
    }
    for (const key of keys) {
      previous.usedKeys.add(key);
    }
    mrtrByTask.set(record, {
      ...previous,
      ...(raw.inputRequests ? { inputRequests: raw.inputRequests } : {}),
      state: raw.state,
    });
    store.update(record.taskId, { status: 'input_required' });
    return;
  }
  const toolResult = isObject(raw) && raw.content === undefined ? { ...raw, content: [] } : raw;
  if (!isSpecType.CallToolResult(toolResult)) {
    throw new ProtocolError(-32603, 'Task handler returned an invalid tools/call result');
  }
  const result = {
    ...(toolResult as Record<string, unknown>),
    resultType: 'complete',
    _meta: { ...(toolResult as { _meta?: object })._meta, ...resultMeta() },
  };
  mrtrByTask.delete(record);
  runnerByTask.delete(record);
  store.update(record.taskId, { status: 'completed', result });
  getMetrics()?.tasks.inc({ status: 'completed' });
};

const runRound = (record: ITaskRecord, inputResponses?: Record<string, unknown>): void => {
  const store = getTaskStore();
  const runner = runnerByTask.get(record);
  if (!runner) {
    return;
  }
  const mrtr = mrtrByTask.get(record);
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
        const safe = safeTaskError(error);
        store.update(record.taskId, { status: 'failed', statusMessage: safe.message, error: safe });
        getMetrics()?.tasks.inc({ status: 'failed' });
      }
      mrtrByTask.delete(record);
      runnerByTask.delete(record);
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
}): (ReturnType<typeof toModernTaskDto> & { resultType: 'task' }) | undefined => {
  const { tool, caps, subjectKey, runToolCall } = options;
  if (appConfig.mcp.tasks?.enabled !== true || !clientDeclaredTasksExtension(caps)) {
    return undefined;
  }
  const support = (tool as { execution?: { taskSupport?: string } }).execution?.taskSupport ?? 'forbidden';
  if (support !== 'optional' && support !== 'required') {
    return undefined;
  }
  const store = getTaskStore();
  const record = store.create({ method: 'tools/call', toolName: tool.name, subjectKey });
  getMetrics()?.tasks.inc({ status: 'created' });
  runnerByTask.set(record, runToolCall);
  mrtrByTask.set(record, { usedKeys: new Set(), caps });
  runRound(record);
  return { resultType: 'task', ...toModernTaskDto(record, store.pollIntervalMs) };
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
      _meta: resultMeta(),
    },
  },
});

const rpcError = (id: IJsonRpcShape['id'], status: number, code: number, message: string, data?: unknown) => ({
  status,
  json: {
    jsonrpc: '2.0' as const,
    id: typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)) ? id : null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  },
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
  headers?: Headers,
  modernConnection = false,
): { status: number; json: Record<string, unknown> } | undefined => {
  const req = body as IJsonRpcShape;
  if (!req || typeof req !== 'object' || !MODERN_TASK_METHODS.has(req.method ?? '')) {
    return undefined;
  }
  const meta = req.params?._meta;
  if (
    !modernConnection &&
    !meta?.['io.modelcontextprotocol/protocolVersion'] &&
    !headers?.get('mcp-protocol-version')
  ) {
    return undefined;
  }
  const { id } = req;
  if (req.jsonrpc !== '2.0' || (typeof id !== 'string' && (typeof id !== 'number' || !Number.isFinite(id)))) {
    return rpcError(id, 400, -32600, 'Task methods require a JSON-RPC request with an id');
  }
  if (!isObject(req.params)) {
    return rpcError(id, 400, -32602, 'Invalid params: expected object');
  }
  const route = classifyInboundRequest({
    httpMethod: 'POST',
    body,
    ...(headers
      ? {
          ...(headers.has('mcp-protocol-version')
            ? { protocolVersionHeader: headers.get('mcp-protocol-version')! }
            : {}),
          ...(headers.has('mcp-method') ? { mcpMethodHeader: headers.get('mcp-method')! } : {}),
        }
      : {}),
  });
  if (route.kind === 'reject') {
    return rpcError(id, route.httpStatus, route.code, route.message, route.data);
  }
  if (!isObject(meta) || !isSpecType.ClientCapabilities(meta['io.modelcontextprotocol/clientCapabilities'])) {
    return rpcError(id, 400, -32602, 'Invalid client capabilities');
  }
  const version = meta['io.modelcontextprotocol/protocolVersion'];
  if (version !== '2026-07-28') {
    return rpcError(id, 400, -32022, 'Unsupported protocol version', { supported: ['2026-07-28'], requested: version });
  }
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
  if (headers && (headers.get('mcp-method')?.trim() !== req.method || headers.get('mcp-name')?.trim() !== taskId)) {
    return rpcError(id, 400, -32020, 'Task routing headers do not match the request');
  }
  const store = getTaskStore();
  const subjectKey = subjectKeyOf(authPayload);
  const record = store.get(taskId);
  if (!record || record.subjectKey !== subjectKey) {
    // Same answer for "not found" and "foreign task" — no existence oracle across subjects.
    return rpcError(id, 400, -32_602, 'Unknown task', { field: 'taskId', reason: 'unknown_task' });
  }

  if (req.method === 'tasks/get') {
    const mrtr = mrtrByTask.get(record);
    if (record.status === 'input_required' && missingCapabilitiesForInputRequests(mrtr?.inputRequests, caps).length) {
      return rpcError(id, 400, -32021, 'Client does not support the pending task input');
    }
    return ok(id, {
      ...toModernTaskDto(record, store.pollIntervalMs),
      ...(record.status === 'input_required' && mrtr?.inputRequests ? { inputRequests: mrtr.inputRequests } : {}),
      ...(record.status === 'completed' && record.result !== undefined ? { result: record.result } : {}),
      ...(record.status === 'failed'
        ? { error: record.error ?? { code: -32_603, message: record.statusMessage ?? 'Task failed' } }
        : {}),
    });
  }

  if (req.method === 'tasks/update') {
    const responses = req.params?.inputResponses;
    const mrtr = mrtrByTask.get(record);
    const expected = Object.keys(mrtr?.inputRequests ?? {});
    const outstanding = isObject(responses)
      ? Object.fromEntries(Object.entries(responses).filter(([key]) => expected.includes(key)))
      : undefined;
    // Unknown or previously satisfied keys are ignored, never used to restart the handler.
    if (
      record.status === 'input_required' &&
      isObject(responses) &&
      Object.keys(responses).length &&
      outstanding &&
      !Object.keys(outstanding).length
    ) {
      return ok(id, {});
    }
    if (
      !outstanding ||
      !expected.length ||
      Object.keys(outstanding).length !== expected.length ||
      !expected.every(
        (key) =>
          Object.hasOwn(outstanding, key) &&
          isObject(outstanding[key]) &&
          validInputResponse(mrtr!.inputRequests![key]!.method, outstanding[key]),
      )
    ) {
      return rpcError(id, 400, -32602, 'inputResponses must contain exactly the outstanding input request keys');
    }
    if (missingCapabilitiesForInputRequests(mrtr?.inputRequests, caps).length) {
      return rpcError(id, 400, -32021, 'Client does not support the pending task input');
    }
    if (record.status !== 'input_required') {
      return rpcError(id, 400, -32_602, 'Task is not awaiting input', {
        field: 'taskId',
        reason: 'task_not_input_required',
      });
    }
    store.update(record.taskId, { status: 'working' });
    mrtr!.caps = caps;
    runRound(record, outstanding);
    return ok(id, {});
  }

  // tasks/cancel
  const wasActive = !isTerminalTaskStatus(record.status);
  const updated = store.cancel(record.taskId) ?? record;
  if (wasActive && updated.status === 'cancelled') {
    getMetrics()?.tasks.inc({ status: 'cancelled' });
    mrtrByTask.delete(record);
    runnerByTask.delete(record);
  }
  return ok(id, {});
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const validInputResponse = (method: string, value: unknown): boolean => {
  if (method === 'elicitation/create') {
    return isSpecType.ElicitResult(value);
  }
  if (method === 'roots/list') {
    return isSpecType.ListRootsResult(value);
  }
  if (method === 'sampling/createMessage') {
    return isSpecType.CreateMessageResult(value);
  }
  return false;
};

const subjectKeyOf = (payload: Record<string, unknown> | undefined): string => {
  const sub = payload?.sub ?? payload?.user;
  return typeof sub === 'string' && sub.trim() ? sub.trim().toLowerCase() : 'anonymous';
};
