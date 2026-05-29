/**
 * Centralized error handling system for the MCP server
 */

import { McpError } from '@modelcontextprotocol/sdk/types.js';

import { logger } from '../logger.js';
import { getCurrentRequestId } from '../web/request-id.js';

import { BaseMcpError, IMcpErrorData } from './BaseMcpError.js';

/**
 * Absolute filesystem paths that may leak into a raw error message. We scrub them from any
 * outward-facing text as a belt-and-suspenders measure on top of the code-based decision in
 * {@link sanitizeOutwardMessage} — covers the case where a developer accidentally embeds a path
 * inside an otherwise "safe" domain error. Standard §13.3 / Appendix C.3.
 */
const ABSOLUTE_PATH_RE = /(?:[A-Za-z]:\\[^\s'"]+|\/(?:home|usr|var|etc|root|opt|tmp|mnt|srv|Users|proc)\/[^\s'"]*)/g;

function stripSensitive(message: string): string {
  return message.replace(ABSOLUTE_PATH_RE, '[path]');
}

/**
 * Standard §13.3 / Appendix C.3 — decide what error text is safe to send to the client.
 *
 * A {@link BaseMcpError} carrying an explicit, developer-assigned `jsonRpcCode` (every class in
 * `specific-errors.ts`, plus domain tool errors) is intentional: its message was written to be
 * shown, so it is returned verbatim (with absolute paths still scrubbed). Anything else — an
 * unknown throw, a generic `Error`, or a `BaseMcpError` without an explicit code (becomes the
 * generic `-32603` / `-32000`) — may carry a stack frame, SQL fragment, internal module name or
 * connection string, so the outward message collapses to the opaque `Internal error` and the full
 * original text is written to the internal log keyed by the current `requestId` for correlation.
 */
export function sanitizeOutwardMessage(error: unknown): string {
  if (error instanceof BaseMcpError && typeof error.jsonRpcCode === 'number') {
    return stripSensitive(error.message);
  }
  const requestId = getCurrentRequestId();
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  logger.error(`[${requestId ?? 'no-request-id'}] internal error: ${detail}`);
  return 'Internal error';
}

function buildErrorData(error: BaseMcpError): IMcpErrorData | undefined {
  let data: IMcpErrorData | undefined = error.data ?? (error.details as IMcpErrorData | undefined);
  const requestId = getCurrentRequestId();
  if (requestId && !data?.requestId) {
    data = { ...data, requestId };
  }
  return data;
}

/**
 * Convert any value thrown inside an MCP request handler into an SDK {@link McpError} with the
 * correct numeric JSON-RPC code and a sanitized message. The SDK serializes a thrown error by its
 * numeric `.code` (falling back to `-32603`), but {@link BaseMcpError}'s `.code` is a string — so
 * without this bridge a `ResourceNotFoundError` or `UpstreamUnavailableError` would reach the wire
 * as `-32603`. Already-`McpError` values pass through untouched.
 */
export function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) {
    return error;
  }
  const message = sanitizeOutwardMessage(error);
  if (error instanceof BaseMcpError && typeof error.jsonRpcCode === 'number') {
    return new McpError(error.jsonRpcCode, message, buildErrorData(error));
  }
  const requestId = getCurrentRequestId();
  return new McpError(-32603, message, requestId ? { requestId } : undefined);
}

export class ToolExecutionError extends BaseMcpError {
  constructor(toolName: string, message: string, printed?: boolean) {
    super('TOOL_EXECUTION_ERROR', `Failed to execute tool '${toolName}': ${message}`, undefined, 400, printed);
  }
}

/**
 * Server-related errors
 */
export class ServerError extends BaseMcpError {
  constructor(message: string, details?: Record<string, unknown>, printed?: boolean) {
    super('SERVER_ERROR', message, details, 500, printed);
  }
}

/**
 * Create JSON-RPC 2.0 error response.
 *
 * `error.data` follows the canonical Appendix B.3 shape — `requestId`, `field`, `reason`,
 * `retryAfter` (plus implementation-specific keys). The JSON-RPC numeric code is taken from
 * `error.jsonRpcCode` when present (set by specific-errors), otherwise falls back to `-32000`
 * for any `BaseMcpError` without an explicit code, and `-32603` for unknown errors.
 *
 * Internal stack traces and file paths are NEVER copied into `error.data` — standard §13.3.
 */
export function createJsonRpcErrorResponse(
  error: Error | BaseMcpError,
  requestId?: string | number | null,
  extraData?: IMcpErrorData,
): any {
  const isMcpError = error instanceof BaseMcpError;

  const jsonRpcCode = isMcpError ? (typeof error.jsonRpcCode === 'number' ? error.jsonRpcCode : -32000) : -32603;

  // Prefer the structured `data` field (Appendix B.3). Fall back to the legacy `details` payload
  // only when no `data` was supplied — keeps older callers working without leaking arbitrary
  // shape into the canonical slot.
  const baseData = isMcpError ? (error.data ?? (error.details as IMcpErrorData | undefined)) : undefined;
  let mergedData: IMcpErrorData | undefined = baseData || extraData ? { ...baseData, ...extraData } : undefined;

  // Standard §15.1 — surface the correlation id on every error response, but never
  // overwrite one that the caller already supplied (e.g. cross-process bridges).
  const currentRequestId = getCurrentRequestId();
  if (currentRequestId && !mergedData?.requestId) {
    mergedData = { ...mergedData, requestId: currentRequestId };
  }

  return {
    jsonrpc: '2.0',
    id: requestId ?? 1,
    error: {
      code: jsonRpcCode,
      // Standard §13.3 — never copy raw internal text outward; collapse unknown errors to a
      // generic message and keep the detail in the internal log keyed by requestId.
      message: sanitizeOutwardMessage(error),
      ...(mergedData ? { data: mergedData } : {}),
    },
  };
}

export const toError = (err: any): Error => {
  return err instanceof Error ? err : new Error(String(err));
};

export const toStr = (err: any): string => {
  return err instanceof Error ? err.message : err ? String(err) : 'Unknown error';
};

export const addErrorMessage = (err: any, msg: string) => {
  if (err instanceof Error) {
    err.message = `${msg}. ${err.message}`;
  }
};
