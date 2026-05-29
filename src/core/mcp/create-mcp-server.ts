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
import { toMcpError } from '../errors/errors.js';
import { RateLimitedError } from '../errors/specific-errors.js';
import { getTools, normalizeHeaders } from '../utils/utils.js';
import { getCurrentRequestContext, IRequestContext, runWithRequestContext } from '../web/request-id.js';
import { getMetrics } from '../metrics/metrics.js';

import {
  applyDeprecationToDescription,
  assertDeprecationConsistency,
  readDeprecation,
  warnDeprecatedUsage,
} from './deprecation.js';
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
import { truncateToolResponse, withToolTimeout } from './tool-limits.js';
import { validateToolInput, validateToolOutput } from './validate-tool-args.js';

/**
 * Standard §14 — per-subject in-flight counter for tools/call. Keys are the JWT `sub`
 * (or 'anonymous' when auth is disabled / token is absent). Excess concurrent calls
 * raise RateLimitedError with the standard `Retry-After` semantics.
 */
const inFlightBySubject = new Map<string, number>();

function subjectKeyFromAuth(authInfo: any): string {
  const sub = authInfo?.payload?.sub ?? authInfo?.payload?.user ?? authInfo?.username;
  if (typeof sub === 'string' && sub.trim()) {
    return sub.trim().toLowerCase();
  }
  return 'anonymous';
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
 */
export function createMcpServer(transportType: TTransportType): Server {
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
      },
    },
  );

  if (loggingCapEnabled) {
    registerLoggingCapability(server);
  }

  const ctx = (extra: { requestInfo?: { headers?: Record<string, any> }; authInfo?: any }): ITransportContext => {
    const headers = extra.requestInfo?.headers ? normalizeHeaders(extra.requestInfo.headers) : undefined;
    const payload = extra.authInfo?.payload as ITransportContext['payload'];
    const caps = server.getClientCapabilities() as IClientCapabilities | undefined;
    return {
      transport: transportType,
      ...(headers ? { headers } : {}),
      ...(payload ? { payload } : {}),
      ...(caps ? { clientCapabilities: caps } : {}),
    };
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
      const raw = await getTools(ctx(extra));
      const tools = raw.map((t: any) => {
        const info = readDeprecation(t);
        if (!info) {
          return t;
        }
        assertDeprecationConsistency('tool', t.name, info);
        return { ...t, description: applyDeprecationToDescription(t.description, info) };
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

  // Handler for tool execution. The call is wrapped by `withToolTimeout` (standard §14 —
  // `mcp.limits.toolTimeoutMs`) and `truncateToolResponse` (standard §12.2 — oversized
  // results are surfaced with explicit `truncated: true` markers). Arguments are validated
  // against the tool's `inputSchema` (standard §9.3); structuredContent is validated against
  // `outputSchema` (standard §9.4) and mirrored into `content[0]` as JSON text per §12.4.
  server.setRequestHandler(
    CallToolRequestSchema,
    withRequestContext(async (request, extra) => {
      const { toolHandler } = getProjectData();
      const toolName = (request.params as any)?.name ?? 'unknown';
      const args = (request.params as any)?.arguments ?? {};

      const tools = await getTools(ctx(extra));
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        getMetrics()?.toolCalls.inc({ tool: toolName, status: 'invalid_params' });
        throw new McpError(-32602, `Unknown tool: ${toolName}`, { field: 'name', reason: 'unknown_tool' });
      }

      // Standard §17.2 — deprecation warning is emitted at call-time (rate-limited 1/hour).
      warnDeprecatedUsage('tool', toolName, readDeprecation(tool));

      // Standard §7.5 — scope enforcement for tool dispatch.
      const required: string[] = ((tool as any)._meta?.requiredScopes ??
        (tool as any).requiredScopes ??
        []) as string[];
      if (Array.isArray(required) && required.length > 0) {
        const tokenScopes = String((extra as any)?.authInfo?.payload?.scope ?? '')
          .split(/\s+/)
          .filter(Boolean);
        const missing = required.filter((s) => !tokenScopes.includes(s));
        if (missing.length > 0) {
          getMetrics()?.toolCalls.inc({ tool: toolName, status: 'error' });
          throw new McpError(-32004, `Missing scopes: ${missing.join(',')}`, {
            field: 'scope',
            reason: 'insufficient_scope',
            missing,
          });
        }
      }

      const inputCheck = validateToolInput(tool, args);
      if (!inputCheck.valid) {
        getMetrics()?.toolCalls.inc({ tool: toolName, status: 'invalid_params' });
        throw new McpError(-32602, 'Invalid params', { field: inputCheck.field, reason: inputCheck.reason });
      }

      // Standard §14 — per-subject concurrent in-flight cap.
      const maxConcurrent = appConfig.mcp.rateLimit?.maxConcurrentPerSubject ?? 16;
      const subjectKey = subjectKeyFromAuth((extra as any)?.authInfo);
      const current = inFlightBySubject.get(subjectKey) ?? 0;
      if (current >= maxConcurrent) {
        getMetrics()?.toolCalls.inc({ tool: toolName, status: 'rate_limited' });
        getMetrics()?.rateLimitHits.inc({ scope: 'concurrent' });
        throw new RateLimitedError(
          `Too many concurrent tool calls for subject "${subjectKey}" (limit ${maxConcurrent})`,
          1,
        );
      }
      inFlightBySubject.set(subjectKey, current + 1);
      getMetrics()?.concurrentCalls.set({ subject: subjectKey }, current + 1);

      const stopTimer = getMetrics()?.toolDuration.startTimer({ tool: toolName });
      const progressToken = (request.params as any)?._meta?.progressToken as string | number | undefined;
      const sendProgress = buildSendProgress(progressToken);

      let outcome: 'ok' | 'error' | 'timeout' | 'internal_error' = 'ok';

      try {
        const response = (await withToolTimeout(
          toolName,
          () =>
            toolHandler({
              ...request.params,
              ...ctx(extra),
              // Standard §8.5 — propagate cancellation to user code.
              signal: extra.signal,
              // Standard §8.6 — progress emitter (no-op when no progressToken).
              sendProgress,
            }) as Promise<any>,
        )) as any;

        if (response && typeof response === 'object' && 'structuredContent' in response) {
          const outputCheck = validateToolOutput(tool, (response as any).structuredContent);
          if (!outputCheck.valid) {
            outcome = 'internal_error';
            throw new McpError(-32603, 'Tool produced result that violates outputSchema', {
              field: outputCheck.field,
              reason: outputCheck.reason,
            });
          }
          // §12.4 — mirror structuredContent in content[0] as JSON text for legacy clients.
          const existingContent = Array.isArray((response as any).content) ? (response as any).content : undefined;
          const hasText = existingContent?.some((p: any) => p?.type === 'text' && typeof p?.text === 'string');
          if (!hasText) {
            let serialized: string;
            try {
              serialized = JSON.stringify((response as any).structuredContent ?? null, null, 2);
            } catch {
              serialized = '';
            }
            (response as any).content = [{ type: 'text', text: serialized }, ...(existingContent ?? [])];
          }
        }

        const truncated = truncateToolResponse(response) as any;
        try {
          const resultBytes = JSON.stringify(truncated ?? null).length;
          getMetrics()?.resultBytes.observe(resultBytes);
        } catch {
          // ignore serialization-only failures
        }
        return truncated;
      } catch (err) {
        if (outcome === 'ok') {
          const code = (err as { code?: number })?.code;
          if (code === -32004) {
            outcome = 'timeout';
          } else {
            outcome = 'error';
          }
        }
        throw err;
      } finally {
        stopTimer?.();
        getMetrics()?.toolCalls.inc({ tool: toolName, status: outcome });
        const after = (inFlightBySubject.get(subjectKey) ?? 1) - 1;
        if (after <= 0) {
          inFlightBySubject.delete(subjectKey);
          getMetrics()?.concurrentCalls.set({ subject: subjectKey }, 0);
        } else {
          inFlightBySubject.set(subjectKey, after);
          getMetrics()?.concurrentCalls.set({ subject: subjectKey }, after);
        }
      }
    }),
  );

  // Handlers for prompts are registered only when the server actually has prompts (standard §8.2).
  // When absent, prompts/list and prompts/get fall through to the SDK's -32601 (method not found).
  if (hasPrompts) {
    // Handler for listing available prompts (standard §8.4 — server-side pagination).
    server.setRequestHandler(
      ListPromptsRequestSchema,
      withRequestContext(async (request, extra) => {
        const result = await getPromptsList(ctx(extra));
        const prompts = result.prompts.map((p: any) => {
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
        const promptName = (request.params as any)?.name;
        if (promptName) {
          const { prompts } = await getPromptsList(ctx(extra));
          const prompt = prompts.find((p: any) => p.name === promptName);
          warnDeprecatedUsage('prompt', promptName, readDeprecation(prompt));
        }
        return await getPrompt(request, ctx(extra));
      }),
    );
  }

  // Handler for listing available resources (standard §8.4 — server-side pagination).
  server.setRequestHandler(
    ListResourcesRequestSchema,
    withRequestContext(async (request, extra) => {
      const result = await getResourcesList(ctx(extra));
      const resources = result.resources.map((r: any) => {
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
      const { uri } = request.params;
      if (uri) {
        const { resources } = await getResourcesList(ctx(extra));
        const resource = resources.find((r: any) => r.uri === uri);
        warnDeprecatedUsage('resource', uri, readDeprecation(resource));
      }
      return (await getResource(uri, ctx(extra))) as any;
    }),
  );

  // Optional MAY: resources/templates/list — empty list if no templates configured.
  if (templatesEnabled) {
    server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      withRequestContext(async (request, extra) => {
        const templates = await getResourceTemplatesList(ctx(extra));
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
      withRequestContext(async (request) => {
        const params = (request.params ?? {}) as {
          ref: { type: 'ref/prompt' | 'ref/resource'; name?: string; uri?: string };
          argument: { name: string; value: string };
          context?: Record<string, unknown>;
        };
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
    server.setRequestHandler(SubscribeRequestSchema, async (request) => {
      const uri = (request.params as any)?.uri;
      subscribeResource(server, uri);
      return {};
    });
    server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
      const uri = (request.params as any)?.uri;
      unsubscribeResource(server, uri);
      return {};
    });
  }

  return server;
}
