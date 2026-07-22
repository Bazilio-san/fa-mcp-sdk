import { randomUUID } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  ListTasksRequestSchema,
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  CancelTaskRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import {
  IClientCapabilities,
  IGetPromptRequest,
  IReadResourceRequest,
  ITransportContext,
  TTransportType,
} from '../_types_/types.js';
import { appConfig, getProjectData } from '../bootstrap/init-config.js';
import { transportPrincipal } from '../auth/principal.js';
import { sanitizeOutwardMessage, toMcpError } from '../errors/errors.js';
import { RateLimitedError, ResourceNotFoundError } from '../errors/specific-errors.js';
import { getTools, normalizeTransportHeaders } from '../utils/utils.js';
import { getCurrentRequestContext, IRequestContext, runWithRequestContext } from '../web/request-id.js';
import { getMetrics } from '../metrics/metrics.js';

import {
  applyDeprecationToDescription,
  assertDeprecationConsistency,
  readDeprecation,
  warnDeprecatedUsage,
} from './deprecation.js';
import { emitTrace } from './debug-trace.js';
import { registerLoggingCapability } from './mcp-logging.js';
import { paginate, parsePageSize } from './pagination.js';
import { getPrompt, getPromptsList } from './prompts.js';
import {
  getResource,
  getResourcesList,
  getResourceTemplatesList,
  subscribeResource,
  unsubscribeResource,
} from './resources.js';
import { getTaskStore, isTerminalTaskStatus, toTaskDto, ITaskRecord } from './task-store.js';
import { assertRequiredScopes, getToolRequiredScopes, missingRequiredScopes } from './required-scopes.js';
import { serializedToolResultBytes, truncateToolResponse, withToolTimeout } from './tool-limits.js';
import { beginToolTrace, completeToolTrace, failToolTrace } from './tool-trace.js';
import { validateToolInput, validateToolOutput } from './validate-tool-args.js';
import { resolveToolAlias } from './validate-tool-names.js';

/**
 * Standard §14 — per-subject in-flight counter for tools/call. Keys are the JWT `sub`
 * (or 'anonymous' when auth is disabled / token is absent). Excess concurrent calls
 * raise RateLimitedError with the standard `Retry-After` semantics.
 */
const inFlightBySubject = new Map<string, number>();
let totalInFlight = 0;

function subjectKeyFromContext(context: ITransportContext): string {
  return transportPrincipal(context);
}

function missingToolScopes(tool: any, context: ITransportContext): string[] {
  return missingRequiredScopes(getToolRequiredScopes(tool), context, 'tool');
}

export interface ICreateMcpServerOptions {
  /**
   * Supply transport-owned request context that cannot be represented by the MCP SDK's
   * `RequestHandlerExtra`. The legacy SSE adapter uses this to preserve the authenticated
   * connection context while still executing every method through the canonical handlers.
   */
  contextProvider?: (
    extra: { requestInfo?: { headers?: Record<string, any> }; authInfo?: any },
    defaultContext: ITransportContext,
  ) => ITransportContext;
}

/**
 * Standard §14 — try to claim a per-subject in-flight slot. Returns false when the subject is at
 * its `maxConcurrentPerSubject` cap (caller raises RateLimitedError). Shared by the synchronous
 * tools/call path and the task path so a `working` task occupies a slot exactly like a sync call.
 */
function tryAcquireSlot(subjectKey: string, maxConcurrent: number): boolean {
  const current = inFlightBySubject.get(subjectKey) ?? 0;
  if (current >= maxConcurrent) {
    return false;
  }
  inFlightBySubject.set(subjectKey, current + 1);
  totalInFlight += 1;
  getMetrics()?.concurrentCalls.set(totalInFlight);
  return true;
}

function releaseSlot(subjectKey: string): void {
  const after = (inFlightBySubject.get(subjectKey) ?? 1) - 1;
  if (after <= 0) {
    inFlightBySubject.delete(subjectKey);
  } else {
    inFlightBySubject.set(subjectKey, after);
  }
  totalInFlight = Math.max(0, totalInFlight - 1);
  getMetrics()?.concurrentCalls.set(totalInFlight);
}

/**
 * Create MCP Server instance with registered tool and prompt handlers.
 *
 * The same `Server` is driven by every SDK transport (stdio + Streamable HTTP), so handlers build
 * their {@link ITransportContext} from the per-request `extra` (`RequestHandlerExtra`) that the SDK
 * passes as the second argument:
 *   - `extra.requestInfo.headers` — full request headers (HTTP only; absent on stdio);
 *   - `extra.authInfo` — whatever the transport read from `req.auth` (HTTP auth middleware bridge);
 *   - `server.getClientCapabilities()` — capabilities reported during the `initialize` handshake,
 *     reliable because each HTTP session owns its own `Server` instance (stateful transport).
 *
 * @param transportType — transport that owns this server instance, surfaced to handlers as
 *   `ITransportContext.transport`.
 * @param options — optional transport adapter hooks. Product code normally leaves this empty.
 */
export function createMcpServer(transportType: TTransportType, options: ICreateMcpServerOptions = {}): Server {
  const resourcesCfg = appConfig.mcp.resources;
  const subscribeEnabled = resourcesCfg?.subscribeEnabled === true;
  const templatesEnabled = resourcesCfg?.templatesEnabled === true;
  const resourceCapability: Record<string, boolean> = {};
  if (subscribeEnabled) {
    resourceCapability.subscribe = true;
    resourceCapability.listChanged = true;
  }

  const loggingCapEnabled = appConfig.mcp.logging?.enabled !== false;

  // Standard §8.2 — advertise only the capabilities the server actually supports.
  //
  // `resources` and `tools` are always advertised: built-in resources (project://*, use://auth,
  // doc://readme) are present in every configuration, and an MCP SDK without tools has no purpose.
  //
  // `prompts` is conditional: a server configured without agent briefs and without customPrompts
  // serves no prompts, so advertising the capability (and registering its handlers) would violate
  // §8.2 — instead the prompts/* methods stay unregistered and return -32601 per §8.3.
  const projectData = getProjectData();
  const hasPrompts = Boolean(
    (projectData?.agentBrief && projectData?.agentPrompt) ||
    typeof projectData?.customPrompts === 'function' ||
    (Array.isArray(projectData?.customPrompts) && projectData.customPrompts.length > 0),
  );

  // Standard §8.2 (MAY) — completion/complete is opt-in: requires both the config flag and a
  // project-supplied provider. Without a provider there is nothing to serve, so the capability
  // is not advertised and completion/complete returns -32601.
  const completionsEnabled =
    appConfig.mcp.completions?.enabled === true && typeof projectData?.completionProvider === 'function';

  // Standard §8.7 (MAY) — task-augmented execution is opt-in. When off (default) the capability is
  // NOT advertised and the tasks/* methods stay unregistered (returning -32601), exactly as §8.7
  // requires for a server that does not support tasks. When on, the server advertises that it can
  // list and cancel tasks, and that task creation is supported for `tools/call`.
  const tasksEnabled = appConfig.mcp.tasks?.enabled === true;

  // Standard §8.3 — validate tools/call arguments against the tool's inputSchema before dispatch.
  // On by default; set `mcp.tools.validateInput: false` to skip it (e.g. when tools validate their
  // own arguments, or to shave latency in trusted internal deployments).
  const validateInput = appConfig.mcp.tools?.validateInput !== false;

  const server = new Server(
    {
      name: appConfig.name,
      version: appConfig.version,
    },
    {
      capabilities: {
        tools: {},
        ...(hasPrompts ? { prompts: {} } : {}),
        resources: resourceCapability,
        ...(loggingCapEnabled ? { logging: {} } : {}),
        ...(completionsEnabled ? { completions: {} } : {}),
        ...(tasksEnabled
          ? {
              tasks: {
                list: {},
                cancel: {},
                // Task creation is supported only for tools/call (the only long-running path here).
                // Shape per ServerTasksCapabilitySchema: requests.tools.call.
                requests: { tools: { call: {} } },
              },
            }
          : {}),
      },
    },
  );

  if (loggingCapEnabled) {
    registerLoggingCapability(server);
  }

  const ctx = (extra: { requestInfo?: { headers?: Record<string, any> }; authInfo?: any }): ITransportContext => {
    const headers = extra.requestInfo?.headers ? normalizeTransportHeaders(extra.requestInfo.headers) : undefined;
    const payload = extra.authInfo?.payload as ITransportContext['payload'];
    const principal = typeof extra.authInfo?.principal === 'string' ? extra.authInfo.principal : undefined;
    const caps = server.getClientCapabilities() as IClientCapabilities | undefined;
    const defaultContext: ITransportContext = {
      transport: transportType,
      ...(headers ? { headers } : {}),
      ...(payload ? { payload } : {}),
      ...(principal ? { principal } : {}),
      ...(caps ? { clientCapabilities: caps } : {}),
    };
    return options.contextProvider?.(extra, defaultContext) ?? defaultContext;
  };

  const pageSize = parsePageSize(appConfig.mcp.pagination?.pageSize);

  /**
   * Standard §15.1 — every handler runs inside an {@link IRequestContext}.
   * HTTP path: middleware already entered the AsyncLocalStorage scope, so we
   * only enrich the existing context with `jsonRpcId`.
   * Stdio path: no middleware ran — we mint a `stdio-<uuid>` request id so
   * logs, errors and notifications can be correlated end-to-end.
   */
  const withRequestContext = <H extends (req: any, extra: any) => Promise<any>>(handler: H): H => {
    return (async (req: any, extra: any) => {
      const jsonRpcId = (extra as { requestId?: string | number | null })?.requestId ?? null;
      const existing = getCurrentRequestContext();
      const reqCtx: IRequestContext = existing
        ? { ...existing, jsonRpcId }
        : { requestId: `stdio-${randomUUID()}`, jsonRpcId };
      return runWithRequestContext(reqCtx, async () => {
        try {
          return await handler(req, extra);
        } catch (err) {
          // Standard §13.3 — every handler error is mapped to an SDK McpError with the correct
          // numeric JSON-RPC code and a sanitized message before the transport serializes it.
          throw toMcpError(err);
        }
      });
    }) as unknown as H;
  };

  // Handler for listing available tools (standard §8.4 — server-side pagination).
  server.setRequestHandler(
    ListToolsRequestSchema,
    withRequestContext(async (request, extra) => {
      const transportContext = ctx(extra);
      // Standard §7.5 / G6 — discovery reflects authorization. A tool that the current
      // principal cannot call is not advertised, while direct calls remain independently denied.
      const raw = (await getTools(transportContext)).filter(
        (tool) => missingToolScopes(tool, transportContext).length === 0,
      );
      const tools = raw
        .map((t: any) => {
          const info = readDeprecation(t);
          if (!info) {
            return t;
          }
          assertDeprecationConsistency('tool', t.name, info);
          return { ...t, description: applyDeprecationToDescription(t.description, info) };
        })
        .map((tool: any) => {
          if (appConfig.mcp.tools?.hideAnnotations !== true) {
            return tool;
          }
          const { annotations: _annotations, ...publicTool } = tool;
          return publicTool;
        });
      const cursor = (request.params as any)?.cursor;
      const { page, nextCursor } = paginate(tools, cursor, pageSize, (t) => t.name);
      return nextCursor ? { tools: page, nextCursor } : { tools: page };
    }),
  );

  const progressThrottleMs = appConfig.mcp.progress?.throttleMs ?? 100;

  /**
   * Build a `sendProgress` emitter scoped to a single tools/call. Active only when the request
   * carried `_meta.progressToken`; otherwise returns a no-op so handlers can call it
   * unconditionally. Enforces monotonic increase and `throttleMs` server-side per §8.6.
   */
  const buildSendProgress = (
    progressToken: string | number | undefined,
  ): ((progress: number, total?: number, message?: string) => void) => {
    if (progressToken === undefined || progressToken === null) {
      return () => {};
    }
    let lastEmit = 0;
    let lastProgress = -Infinity;
    return (progress: number, total?: number, message?: string) => {
      if (typeof progress !== 'number' || Number.isNaN(progress)) {
        return;
      }
      if (progress < lastProgress) {
        return;
      }
      const now = Date.now();
      if (now - lastEmit < progressThrottleMs) {
        return;
      }
      lastEmit = now;
      lastProgress = progress;
      const params: Record<string, unknown> = { progressToken, progress };
      if (total !== undefined) {
        params.total = total;
      }
      if (message !== undefined) {
        params.message = message;
      }
      void server.notification({ method: 'notifications/progress', params }).catch(() => {});
    };
  };

  /**
   * Post-process a raw tool response (shared by the synchronous and task paths): validate
   * `structuredContent` against `outputSchema` (§9.4 — throws -32603 on violation), mirror it into
   * `content[0]` as JSON text for legacy clients (§12.4), then truncate oversized payloads (§12.2)
   * and record the serialized size metric. Returns the wire-ready result.
   */
  const finalizeToolResponse = (tool: any, response: any): any => {
    let normalizedResponse = response;
    const hasOutputSchema = Boolean(tool?.outputSchema && typeof tool.outputSchema === 'object');

    // A published outputSchema describes structuredContent. For compatibility with older handlers
    // that returned one JSON text block, promote that block to structuredContent and validate it.
    if (
      hasOutputSchema &&
      (!normalizedResponse ||
        typeof normalizedResponse !== 'object' ||
        !Object.prototype.hasOwnProperty.call(normalizedResponse, 'structuredContent'))
    ) {
      const content = Array.isArray(normalizedResponse?.content) ? normalizedResponse.content : [];
      if (content.length !== 1 || content[0]?.type !== 'text' || typeof content[0]?.text !== 'string') {
        throw new McpError(-32603, 'Tool with outputSchema did not return structuredContent', {
          reason: 'missing_structured_content',
        });
      }
      try {
        normalizedResponse = { ...normalizedResponse, structuredContent: JSON.parse(content[0].text) };
      } catch {
        throw new McpError(-32603, 'Tool with outputSchema returned non-JSON text content', {
          reason: 'missing_structured_content',
        });
      }
    }

    if (normalizedResponse && typeof normalizedResponse === 'object' && 'structuredContent' in normalizedResponse) {
      const outputCheck = validateToolOutput(tool, normalizedResponse.structuredContent);
      if (!outputCheck.valid) {
        throw new McpError(-32603, `Tool produced result that violates outputSchema: ${outputCheck.summary}`, {
          field: outputCheck.field,
          reason: outputCheck.reason,
          errors: outputCheck.errors,
          errorCount: outputCheck.errorCount,
        });
      }
      // §12.4 — mirror structuredContent in content[0] as JSON text for legacy clients.
      const existingContent = Array.isArray(normalizedResponse.content) ? normalizedResponse.content : undefined;
      let serialized: string;
      try {
        serialized = JSON.stringify(normalizedResponse.structuredContent ?? null, null, 2);
      } catch {
        serialized = '';
      }
      const firstIsMirror = existingContent?.[0]?.type === 'text' && existingContent[0].text === serialized;
      if (!firstIsMirror) {
        normalizedResponse = {
          ...normalizedResponse,
          content: [{ type: 'text', text: serialized }, ...(existingContent ?? [])],
        };
      }
    }

    const truncated = truncateToolResponse(normalizedResponse, {
      // MCP defaults readOnlyHint to false. Treat an absent annotation conservatively because the
      // handler has already completed and a retry could duplicate an external side effect.
      readOnly: tool?.annotations?.readOnlyHint === true,
    }) as any;
    const resultBytes = serializedToolResultBytes(truncated);
    if (resultBytes !== undefined) {
      getMetrics()?.resultBytes.observe(resultBytes);
    }
    return truncated;
  };

  const taskStore = tasksEnabled ? getTaskStore() : undefined;

  /** Standard §8.7 — emit notifications/tasks/status for a record's current state. */
  const notifyTaskStatus = (record: ITaskRecord): void => {
    if (!taskStore) {
      return;
    }
    void server
      .notification({ method: 'notifications/tasks/status', params: toTaskDto(record, taskStore.pollIntervalMs) })
      .catch(() => {});
  };

  /**
   * Standard §8.7 — start a tool call as a task: persist a `working` record, return its id
   * immediately, and run the handler in the background. On completion the record transitions to
   * `completed` (with the same result a synchronous call would return) or `failed` (with a
   * sanitized message); cancellation is handled by the tasks/cancel path. The in-flight slot is
   * held for the whole background run and released on the terminal transition.
   */
  const startTask = (
    tool: any,
    toolName: string,
    request: any,
    extra: any,
    subjectKey: string,
    progressToken: string | number | undefined,
  ): { task: ReturnType<typeof toTaskDto> } => {
    const store = taskStore!;
    const { toolHandler } = getProjectData();
    const reqCtx = getCurrentRequestContext();
    const ttlMs = (request.params as any)?.task?.ttl as number | undefined;
    const record = store.create({
      method: 'tools/call',
      toolName,
      subjectKey,
      ...(reqCtx?.requestId ? { requestId: reqCtx.requestId } : {}),
      ...(ttlMs !== undefined ? { ttlMs } : {}),
    });
    getMetrics()?.tasks.inc({ status: 'created' });

    const sendProgress = buildSendProgress(progressToken);
    const transportCtx = ctx(extra);

    const run = async () => {
      const stopTimer = getMetrics()?.toolDuration.startTimer({ tool: toolName });
      let outcome: 'ok' | 'error' | 'timeout' | 'internal_error' = 'ok';
      let handlerSettled: Promise<void> | undefined;
      let holdSlotUntilHandlerSettles = false;
      const bgCtx: IRequestContext = {
        requestId: record.requestId ?? `task-${record.taskId}`,
        jsonRpcId: null,
      };
      await runWithRequestContext(bgCtx, async () => {
        const trace = beginToolTrace(toolName, (request.params as any)?.arguments);
        try {
          const raw = (await withToolTimeout(toolName, record.abort.signal, (signal) => {
            const handlerPromise = Promise.resolve(
              toolHandler({
                ...request.params,
                name: toolName,
                ...transportCtx,
                // Task cancellation and the global tool timeout share the signal supplied to project code.
                signal,
                // Standard §8.6 — progress for the long-running task.
                sendProgress,
              }) as Promise<any>,
            );
            handlerSettled = handlerPromise.then(
              () => undefined,
              () => undefined,
            );
            return handlerPromise;
          })) as any;
          const processed = finalizeToolResponse(tool, raw);
          if (processed?.isError === true) {
            outcome = 'error';
          }
          const current = store.get(record.taskId);
          if (current?.status === 'working') {
            completeToolTrace(trace, toolName, processed);
            const updated = store.update(record.taskId, { status: 'completed', result: processed });
            getMetrics()?.tasks.inc({ status: 'completed' });
            if (updated) {
              notifyTaskStatus(updated);
            }
          } else {
            // The client cancelled while project code ignored AbortSignal and later returned.
            // Record one bounded error completion without publishing or persisting the stale result.
            outcome = 'error';
            failToolTrace(trace, toolName, new Error('Task execution cancelled'));
          }
        } catch (err) {
          failToolTrace(trace, toolName, err);
          const code = (err as { code?: number })?.code;
          outcome = code === -32004 ? 'timeout' : code === -32603 ? 'internal_error' : 'error';
          // A non-cooperative timed-out handler may still mutate state. Keep its subject slot
          // occupied until it actually settles so another call cannot overtake it.
          holdSlotUntilHandlerSettles = code === -32004;
          if (store.get(record.taskId)?.status === 'working') {
            const updated = store.update(record.taskId, {
              status: 'failed',
              statusMessage: code === -32004 ? 'Operation timed out' : sanitizeOutwardMessage(err),
            });
            getMetrics()?.tasks.inc({ status: 'failed' });
            if (updated) {
              notifyTaskStatus(updated);
            }
          }
        } finally {
          stopTimer?.();
          getMetrics()?.toolCalls.inc({ tool: toolName, status: outcome });
          if (holdSlotUntilHandlerSettles && handlerSettled) {
            void handlerSettled.finally(() => releaseSlot(subjectKey));
          } else {
            releaseSlot(subjectKey);
          }
        }
      });
    };
    void run();

    return { task: toTaskDto(record, store.pollIntervalMs) };
  };

  // Handler for tool execution. The call is wrapped by `withToolTimeout` (standard §14 —
  // `mcp.limits.toolTimeoutMs`) and `truncateToolResponse` (standard §12.2 — oversized
  // results are surfaced with explicit `truncated: true` and retry/side-effect markers). Arguments are validated
  // against the tool's `inputSchema` (standard §9.3); structuredContent is validated against
  // `outputSchema` (standard §9.4) and mirrored into `content[0]` as JSON text per §12.4.
  server.setRequestHandler(
    CallToolRequestSchema,
    withRequestContext(async (request, extra) => {
      const { toolHandler } = getProjectData();
      const requestedToolName = (request.params as any)?.name ?? 'unknown';
      const args = (request.params as any)?.arguments ?? {};
      const transportContext = ctx(extra);

      const tools = await getTools(transportContext);
      const toolName = resolveToolAlias(requestedToolName, tools, getProjectData().toolAliases);
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        getMetrics()?.toolCalls.inc({ tool: 'unknown', status: 'invalid_params' });
        throw new McpError(-32602, 'Unknown tool', {
          field: 'name',
          reason: 'unknown_tool',
        });
      }
      if (requestedToolName !== toolName) {
        emitTrace('mcp:tool', { kind: 'legacy-alias', name: toolName });
      }

      // Standard §17.2 — deprecation warning is emitted at call-time (rate-limited 1/hour).
      warnDeprecatedUsage('tool', toolName, readDeprecation(tool));

      // Standard §7.5 — scope enforcement for tool dispatch.
      const missing = missingToolScopes(tool, transportContext);
      if (missing.length > 0) {
        getMetrics()?.toolCalls.inc({ tool: toolName, status: 'forbidden' });
        assertRequiredScopes(getToolRequiredScopes(tool), transportContext, 'tool');
      }

      if (validateInput) {
        const inputCheck = validateToolInput(tool, args);
        if (!inputCheck.valid) {
          getMetrics()?.toolCalls.inc({ tool: toolName, status: 'invalid_params' });
          throw new McpError(-32602, `Invalid params: ${inputCheck.summary}`, {
            field: inputCheck.field,
            reason: inputCheck.reason,
            errors: inputCheck.errors,
            errorCount: inputCheck.errorCount,
          });
        }
      }

      // Standard §14 — per-subject concurrent in-flight cap.
      const maxConcurrent = appConfig.mcp.rateLimit?.maxConcurrentPerSubject ?? 16;
      const subjectKey = subjectKeyFromContext(transportContext);
      const progressToken = (request.params as any)?._meta?.progressToken as string | number | undefined;

      const raiseConcurrencyLimit = (): never => {
        getMetrics()?.toolCalls.inc({ tool: toolName, status: 'rate_limited' });
        getMetrics()?.rateLimitHits.inc({ scope: 'concurrent' });
        throw new RateLimitedError(`Too many concurrent tool calls (limit ${maxConcurrent})`, 1);
      };

      // Standard §8.7 / §9.1 — decide synchronous vs task-augmented execution. Only relevant when
      // the `tasks` capability is enabled; otherwise the `task` param is ignored and the call runs
      // synchronously.
      if (tasksEnabled) {
        const wantsTask = (request.params as any)?.task != null;
        const taskSupport: string = (tool as any)?.execution?.taskSupport ?? 'forbidden';
        if (wantsTask && taskSupport === 'forbidden') {
          getMetrics()?.toolCalls.inc({ tool: toolName, status: 'invalid_params' });
          throw new McpError(-32602, 'Tool does not support tasks', { field: 'task', reason: 'task_not_supported' });
        }
        if (!wantsTask && taskSupport === 'required') {
          getMetrics()?.toolCalls.inc({ tool: toolName, status: 'invalid_params' });
          throw new McpError(-32602, 'Tool requires task-augmented execution', {
            field: 'task',
            reason: 'task_required',
          });
        }
        if (wantsTask) {
          if (!tryAcquireSlot(subjectKey, maxConcurrent)) {
            raiseConcurrencyLimit();
          }
          // The background run releases the slot on its terminal transition.
          return startTask(tool, toolName, request, extra, subjectKey, progressToken);
        }
      }

      // Synchronous path.
      if (!tryAcquireSlot(subjectKey, maxConcurrent)) {
        raiseConcurrencyLimit();
      }

      const stopTimer = getMetrics()?.toolDuration.startTimer({ tool: toolName });
      const sendProgress = buildSendProgress(progressToken);
      const trace = beginToolTrace(toolName, args);

      let outcome: 'ok' | 'error' | 'timeout' | 'internal_error' = 'ok';
      let handlerSettled: Promise<void> | undefined;
      let holdSlotUntilHandlerSettles = false;

      try {
        const response = (await withToolTimeout(toolName, extra.signal, (signal) => {
          const handlerPromise = Promise.resolve(
            toolHandler({
              ...request.params,
              name: toolName,
              ...transportContext,
              // Standard §8.5 — propagate cancellation to user code.
              signal,
              // Standard §8.6 — progress emitter (no-op when no progressToken).
              sendProgress,
            }) as Promise<any>,
          );
          handlerSettled = handlerPromise.then(
            () => undefined,
            () => undefined,
          );
          return handlerPromise;
        })) as any;

        try {
          const processed = finalizeToolResponse(tool, response);
          if (processed?.isError === true) {
            outcome = 'error';
          }
          completeToolTrace(trace, toolName, processed);
          return processed;
        } catch (finalizeErr) {
          if ((finalizeErr as { code?: number })?.code === -32603) {
            outcome = 'internal_error';
          }
          throw finalizeErr;
        }
      } catch (err) {
        failToolTrace(trace, toolName, err);
        if (outcome === 'ok') {
          const code = (err as { code?: number })?.code;
          if (code === -32004) {
            outcome = 'timeout';
            // A timed-out write may still be running when project code ignores AbortSignal. Keep
            // the subject's slot occupied until it really settles so later calls cannot overtake it.
            holdSlotUntilHandlerSettles = true;
          } else {
            outcome = 'error';
          }
        }
        throw err;
      } finally {
        stopTimer?.();
        getMetrics()?.toolCalls.inc({ tool: toolName, status: outcome });
        if (holdSlotUntilHandlerSettles && handlerSettled) {
          void handlerSettled.finally(() => releaseSlot(subjectKey));
        } else {
          releaseSlot(subjectKey);
        }
      }
    }),
  );

  // Standard §8.7 — task lifecycle methods. Registered only when the `tasks` capability is enabled
  // (and advertised), so when off these methods fall through to the SDK's -32601 (method not found).
  if (tasksEnabled && taskStore) {
    const requireOwnedTask = (taskId: string, subjectKey: string): ITaskRecord => {
      const record = taskStore.get(taskId);
      if (!record || record.subjectKey !== subjectKey) {
        // Do not leak whether the id exists for another subject — a uniform "not found".
        throw new ResourceNotFoundError('Task not found', { reason: 'task_not_found' });
      }
      return record;
    };

    // tasks/get — current task metadata (flat Task shape).
    server.setRequestHandler(
      GetTaskRequestSchema,
      withRequestContext(async (request, extra) => {
        const subjectKey = subjectKeyFromContext(ctx(extra));
        const record = requireOwnedTask((request.params as any).taskId, subjectKey);
        return toTaskDto(record, taskStore.pollIntervalMs);
      }),
    );

    // tasks/result — the underlying tools/call result once completed; status placeholder otherwise.
    server.setRequestHandler(
      GetTaskPayloadRequestSchema,
      withRequestContext(async (request, extra) => {
        const subjectKey = subjectKeyFromContext(ctx(extra));
        const record = requireOwnedTask((request.params as any).taskId, subjectKey);
        if (record.status === 'completed') {
          return record.result as any;
        }
        if (record.status === 'failed') {
          return {
            isError: true,
            content: [{ type: 'text', text: record.statusMessage ?? 'Task failed' }],
            structuredContent: { taskId: record.taskId, status: record.status },
          };
        }
        if (record.status === 'cancelled') {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Task was cancelled' }],
            structuredContent: { taskId: record.taskId, status: record.status },
          };
        }
        // working / input_required — not finished yet; return a status placeholder per §8.7.
        return {
          content: [{ type: 'text', text: `Task ${record.taskId} is ${record.status}` }],
          structuredContent: { taskId: record.taskId, status: record.status },
        };
      }),
    );

    // tasks/list — caller's own tasks, newest first, paginated (§8.4).
    server.setRequestHandler(
      ListTasksRequestSchema,
      withRequestContext(async (request, extra) => {
        const subjectKey = subjectKeyFromContext(ctx(extra));
        const records = taskStore.list(subjectKey);
        const cursor = (request.params as any)?.cursor;
        // Descending createdAt encoded as a zero-padded sort key so pagination stays stable.
        const { page, nextCursor } = paginate(
          records,
          cursor,
          pageSize,
          (r) => `${(1e16 - r.createdAt).toString().padStart(17, '0')}-${r.taskId}`,
        );
        const tasks = page.map((r) => toTaskDto(r, taskStore.pollIntervalMs));
        return nextCursor ? { tasks, nextCursor } : { tasks };
      }),
    );

    // tasks/cancel — abort an active task; idempotent on already-finished tasks.
    server.setRequestHandler(
      CancelTaskRequestSchema,
      withRequestContext(async (request, extra) => {
        const subjectKey = subjectKeyFromContext(ctx(extra));
        const { taskId } = request.params as any;
        const existing = requireOwnedTask(taskId, subjectKey);
        const wasActive = !isTerminalTaskStatus(existing.status);
        const updated = taskStore.cancel(taskId) ?? existing;
        if (wasActive && updated.status === 'cancelled') {
          getMetrics()?.tasks.inc({ status: 'cancelled' });
          notifyTaskStatus(updated);
        }
        return toTaskDto(updated, taskStore.pollIntervalMs);
      }),
    );
  }

  // Handlers for prompts are registered only when the server actually has prompts (standard §8.2).
  // When absent, prompts/list and prompts/get fall through to the SDK's -32601 (method not found).
  if (hasPrompts) {
    // Handler for listing available prompts (standard §8.4 — server-side pagination).
    server.setRequestHandler(
      ListPromptsRequestSchema,
      withRequestContext(async (request, extra) => {
        const transportContext = ctx(extra);
        const result = await getPromptsList(transportContext);
        const prompts = result.prompts
          .filter(
            (prompt: any) => missingRequiredScopes(prompt.requiredScopes, transportContext, 'prompt').length === 0,
          )
          .map((p: any) => {
            const info = readDeprecation(p);
            if (!info) {
              return p;
            }
            assertDeprecationConsistency('prompt', p.name, info);
            return { ...p, description: applyDeprecationToDescription(p.description, info) };
          });
        const cursor = (request.params as any)?.cursor;
        const { page, nextCursor } = paginate(prompts, cursor, pageSize, (p: any) => p.name);
        return nextCursor ? { prompts: page, nextCursor } : { prompts: page };
      }),
    );

    // Handler for getting prompt content
    server.setRequestHandler(
      GetPromptRequestSchema,
      // @ts-ignore
      withRequestContext(async (request: IGetPromptRequest, extra) => {
        const transportContext = ctx(extra);
        return await getPrompt(request, transportContext);
      }),
    );
  }

  // Handler for listing available resources (standard §8.4 — server-side pagination).
  server.setRequestHandler(
    ListResourcesRequestSchema,
    withRequestContext(async (request, extra) => {
      const transportContext = ctx(extra);
      const result = await getResourcesList(transportContext);
      const resources = result.resources
        .filter(
          (resource: any) => missingRequiredScopes(resource.requiredScopes, transportContext, 'resource').length === 0,
        )
        .map((r: any) => {
          const info = readDeprecation(r);
          if (!info) {
            return r;
          }
          assertDeprecationConsistency('resource', r.uri, info);
          return { ...r, description: applyDeprecationToDescription(r.description, info) };
        });
      const cursor = (request.params as any)?.cursor;
      const { page, nextCursor } = paginate(resources, cursor, pageSize, (r: any) => r.uri);
      return nextCursor ? { resources: page, nextCursor } : { resources: page };
    }),
  );

  // Handler for reading resource content
  server.setRequestHandler(
    ReadResourceRequestSchema,
    withRequestContext(async (request: IReadResourceRequest, extra) => {
      const transportContext = ctx(extra);
      return (await getResource(request.params.uri, transportContext)) as any;
    }),
  );

  // Optional MAY: resources/templates/list — empty list if no templates configured.
  if (templatesEnabled) {
    server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      withRequestContext(async (request, extra) => {
        const transportContext = ctx(extra);
        const templates = (await getResourceTemplatesList(transportContext)).filter(
          (template: any) =>
            missingRequiredScopes(template.requiredScopes, transportContext, 'resource template').length === 0,
        );
        const cursor = (request.params as any)?.cursor;
        const { page, nextCursor } = paginate(templates, cursor, pageSize, (t: any) => t.uriTemplate ?? t.name ?? '');
        return nextCursor ? { resourceTemplates: page, nextCursor } : { resourceTemplates: page };
      }),
    );
  }

  // Standard §8.2 (MAY) — completion/complete. Registered only when opt-in config + provider are
  // both present, so the capability advertisement and the handler stay in lock-step.
  if (completionsEnabled) {
    const completionProvider = projectData!.completionProvider!;
    server.setRequestHandler(
      CompleteRequestSchema,
      withRequestContext(async (request, extra) => {
        const transportContext = ctx(extra);
        const params = (request.params ?? {}) as {
          ref: { type: 'ref/prompt' | 'ref/resource'; name?: string; uri?: string };
          argument: { name: string; value: string };
          context?: Record<string, unknown>;
        };
        if (params.ref.type === 'ref/prompt') {
          const name = params.ref.name ?? '';
          const { prompts } = await getPromptsList(transportContext);
          const prompt = prompts.find((candidate: any) => candidate.name === name);
          if (!prompt) {
            throw new ResourceNotFoundError('Unknown completion prompt', { reason: 'unknown_prompt' });
          }
          assertRequiredScopes(prompt.requiredScopes, transportContext, 'prompt');
        } else {
          const uri = params.ref.uri ?? '';
          const { resources } = await getResourcesList(transportContext);
          const resource = resources.find((candidate: any) => candidate.uri === uri);
          if (resource) {
            assertRequiredScopes(resource.requiredScopes, transportContext, 'resource');
          } else {
            const templates = await getResourceTemplatesList(transportContext);
            const template = templates.find((candidate: any) => candidate.uriTemplate === uri);
            if (!template) {
              throw new ResourceNotFoundError('Unknown completion resource', { reason: 'unknown_resource' });
            }
            assertRequiredScopes(template.requiredScopes, transportContext, 'resource template');
          }
        }
        const raw = await completionProvider({
          ref: params.ref,
          argument: params.argument,
          ...(params.context ? { context: params.context } : {}),
        });
        const all = Array.isArray(raw) ? raw.map(String) : [];
        // MCP caps completion results at 100 values; `hasMore` flags truncation.
        const values = all.slice(0, 100);
        return { completion: { values, total: all.length, hasMore: all.length > values.length } };
      }),
    );
  }

  // Optional MAY: resources/subscribe + resources/unsubscribe — opt-in via config.
  if (subscribeEnabled) {
    const assertSubscriptionAccess = async (uri: string, transportContext: ITransportContext): Promise<void> => {
      const { resources } = await getResourcesList(transportContext);
      const resource = resources.find((candidate: any) => candidate.uri === uri);
      if (!resource) {
        throw new ResourceNotFoundError('Unknown resource', { reason: 'unknown_resource' });
      }
      assertRequiredScopes(resource.requiredScopes, transportContext, 'resource');
    };
    server.setRequestHandler(
      SubscribeRequestSchema,
      withRequestContext(async (request, extra) => {
        const uri = (request.params as any)?.uri;
        const transportContext = ctx(extra);
        await assertSubscriptionAccess(uri, transportContext);
        subscribeResource(server, uri);
        return {};
      }),
    );
    server.setRequestHandler(
      UnsubscribeRequestSchema,
      withRequestContext(async (request, extra) => {
        const uri = (request.params as any)?.uri;
        const transportContext = ctx(extra);
        await assertSubscriptionAccess(uri, transportContext);
        unsubscribeResource(server, uri);
        return {};
      }),
    );
  }

  return server;
}
