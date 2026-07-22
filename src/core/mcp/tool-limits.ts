import { McpError } from '@modelcontextprotocol/sdk/types.js';

import { appConfig } from '../bootstrap/init-config.js';
import { MCP_ERROR_CODES } from '../errors/specific-errors.js';
import { TToolHandlerResponse } from '../_types_/types.js';

/**
 * Race a tool invocation against `mcp.limits.toolTimeoutMs`. On expiry the returned promise
 * rejects with an SDK `McpError` carrying code `-32004` (standard §14 / Appendix B) and aborts
 * the signal supplied to project code. JavaScript cannot forcibly stop a non-cooperative
 * handler, so the caller must keep its concurrency slot until the execution promise settles.
 * The HTTP-level transport layer in `server-http.ts` runs its own race so the response status
 * becomes 504.
 */
export async function withToolTimeout<T>(
  _toolName: string,
  upstreamSignal: AbortSignal | undefined,
  exec: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = appConfig.mcp.limits.toolTimeoutMs;
  const timeoutController = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const forwardAbort = () => timeoutController.abort(upstreamSignal?.reason);

  if (upstreamSignal?.aborted) {
    forwardAbort();
  } else {
    upstreamSignal?.addEventListener('abort', forwardAbort, { once: true });
  }

  const executionPromise = Promise.resolve().then(() => exec(timeoutController.signal));
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new McpError(MCP_ERROR_CODES.TIMEOUT, 'Tool call timed out', {
          reason: 'tool_timeout',
          retryAfter: 0,
        }),
      );
      // Queue the canonical timeout rejection before a cooperative handler can reject with its
      // own AbortError; the client must consistently receive JSON-RPC code -32004.
      if (!timeoutController.signal.aborted) {
        timeoutController.abort(new DOMException('Tool call timed out', 'TimeoutError'));
      }
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });
  try {
    return await Promise.race([executionPromise, timeoutPromise]);
  } finally {
    upstreamSignal?.removeEventListener('abort', forwardAbort);
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Measure the actual serialized result, including mirrored content, metadata and binary content
 * blocks. Returns `undefined` when the value cannot be represented as JSON.
 */
export function serializedToolResultBytes(response: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(response ?? null);
    return Buffer.byteLength(serialized, 'utf8');
  } catch {
    return undefined;
  }
}

export interface ToolResultLimitPolicy {
  /** Only an explicit read-only annotation makes an automatic retry safe. */
  readOnly: boolean;
}

export type ToolResultLimitSideEffectState = 'not_applicable' | 'completed';

/** Build a bounded MCP tool-level error without publishing invalid structuredContent. */
function truncatedResult(
  maxBytes: number,
  originalBytes: number | undefined,
  policy: ToolResultLimitPolicy,
): TToolHandlerResponse<never> {
  const retryable = policy.readOnly;
  const sideEffectState: ToolResultLimitSideEffectState = retryable ? 'not_applicable' : 'completed';
  const code = retryable ? 'result_too_large' : 'result_too_large_after_side_effect';
  const detail = {
    error: {
      code,
      message: retryable
        ? 'Tool result exceeded the size limit; the read-only call may be retried.'
        : 'Tool completed, but result exceeded the size limit. Side effects completed; do not retry.',
      truncated: true,
      reason: 'max_tool_result_bytes_exceeded',
      maxBytes,
      ...(originalBytes === undefined ? {} : { originalBytes }),
      retryable,
      sideEffectState,
    },
  };
  const response = {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(detail) }],
    _meta: {
      'fa-mcp-sdk/result-limit': {
        code,
        retryable,
        sideEffectState,
      },
    },
  };
  if ((serializedToolResultBytes(response) ?? Infinity) <= maxBytes) {
    return response;
  }

  throw new McpError(-32603, `mcp.limits.maxToolResultBytes=${maxBytes} is too small for a valid truncation response`, {
    reason: 'result_limit_too_small',
  });
}

/**
 * Enforce the serialized result ceiling across the complete wire result. Oversized or
 * non-serializable output is replaced with a small `isError=true` result; dropping the original
 * `structuredContent` avoids publishing a truncation sentinel that violates the tool's outputSchema.
 * Calls are conservatively treated as side-effecting unless the tool explicitly declares
 * `annotations.readOnlyHint=true`, so clients never infer that retrying a completed write is safe.
 */
export function truncateToolResponse<T>(
  response: TToolHandlerResponse<T>,
  policy: ToolResultLimitPolicy = { readOnly: false },
): TToolHandlerResponse<T> {
  const maxBytes = appConfig.mcp.limits.maxToolResultBytes;
  if (!response) {
    return response;
  }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new McpError(-32603, 'mcp.limits.maxToolResultBytes must be a positive finite number', {
      reason: 'invalid_result_limit',
    });
  }

  const resultBytes = serializedToolResultBytes(response);
  if (resultBytes !== undefined && resultBytes <= maxBytes) {
    return response;
  }

  return truncatedResult(maxBytes, resultBytes, policy) as TToolHandlerResponse<T>;
}
