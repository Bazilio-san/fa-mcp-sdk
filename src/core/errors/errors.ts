/**
 * Centralized error handling system for the MCP server
 */

import { getCurrentRequestId } from '../web/request-id.js';

import { BaseMcpError, IMcpErrorData } from './BaseMcpError.js';

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
      message: error.message,
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
