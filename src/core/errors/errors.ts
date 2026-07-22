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

const SAFE_DATA_IDENTIFIER_RE = /^[A-Za-z0-9_.:[\]-]{1,128}$/;
const SAFE_FIELD_RE = /^(?:root|[A-Za-z0-9_.[\]-]{1,128}|\/[A-Za-z0-9_.~/-]{1,255})$/;
const SAFE_VALIDATION_REASON_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const UNSAFE_DATA_TEXT_RE =
  /(?:\b(?:basic|bearer)\s+\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[a-z][a-z0-9+.-]*:\/\/|(?:token|secret|password|api[_-]?key)\s*[:=])/i;

function safeDataIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_DATA_IDENTIFIER_RE.test(value) ? value : undefined;
}

function safeField(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_FIELD_RE.test(value) ? value : undefined;
}

function safeReason(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    return undefined;
  }
  const stripped = stripSensitive(value);
  return stripped === value && !UNSAFE_DATA_TEXT_RE.test(value) ? value : undefined;
}

function safeValidationMessage(field: string, reason: string, value: unknown): string | undefined {
  const message = safeReason(value);
  const prefix = `${field}: `;
  if (!message?.startsWith(prefix)) {
    return undefined;
  }
  const detail = message.slice(prefix.length);
  const fixedDetails: Record<string, string> = {
    additionalProperties: 'unexpected property',
    enum: 'must be one of the declared values',
    const: 'must equal the declared constant',
    pattern: 'must match the declared pattern',
    uniqueItems: 'array items must be unique',
  };
  if (fixedDetails[reason]) {
    return detail === fixedDetails[reason] ? message : undefined;
  }
  const patterns: Record<string, RegExp> = {
    required: /^missing required property "[A-Za-z0-9_.-]{1,128}"$/,
    type: /^expected (?:null|boolean|object|array|number|integer|string), got (?:null|boolean|object|array|number|string|undefined|bigint|symbol|function)$/,
    minimum: /^must be (?:>=?|<=?) -?(?:\d+\.?\d*|\.\d+)$/,
    maximum: /^must be (?:>=?|<=?) -?(?:\d+\.?\d*|\.\d+)$/,
    exclusiveMinimum: /^must be (?:>=?|<=?) -?(?:\d+\.?\d*|\.\d+)$/,
    exclusiveMaximum: /^must be (?:>=?|<=?) -?(?:\d+\.?\d*|\.\d+)$/,
    multipleOf: /^must be a multiple of -?(?:\d+\.?\d*|\.\d+)$/,
    minLength: /^string length must be >= \d+$/,
    maxLength: /^string length must be <= \d+$/,
    minItems: /^array length must be >= \d+$/,
    maxItems: /^array length must be <= \d+$/,
    minProperties: /^object must have >= \d+ properties$/,
    maxProperties: /^object must have <= \d+ properties$/,
    format: /^invalid format, expected [A-Za-z0-9_.-]{1,64}$/,
  };
  return patterns[reason]?.test(detail) ? message : undefined;
}

/**
 * Keep error data deliberately small and non-reflective. Error constructors are public API and
 * may receive downstream payloads or client-supplied identifiers, so arbitrary keys/objects must
 * never be serialized back to the peer.
 */
export function sanitizeErrorData(
  data: unknown,
  includeValidationDiagnostics: boolean = false,
): IMcpErrorData | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }
  const input = data as Record<string, unknown>;
  const output: IMcpErrorData = {};
  const requestId = safeDataIdentifier(input.requestId);
  const field = safeField(input.field);
  const reason = safeReason(input.reason);
  const { retryAfter } = input;
  if (requestId) {
    output.requestId = requestId;
  }
  if (field) {
    output.field = field;
  }
  if (reason) {
    output.reason = reason;
  }
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 86_400) {
    output.retryAfter = retryAfter;
  }
  if (includeValidationDiagnostics && Array.isArray(input.errors)) {
    const errors = input.errors.slice(0, 8).flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return [];
      }
      const candidate = entry as Record<string, unknown>;
      const failureField = safeField(candidate.field);
      const failureReason =
        typeof candidate.reason === 'string' && SAFE_VALIDATION_REASON_RE.test(candidate.reason)
          ? candidate.reason
          : undefined;
      const failureMessage =
        failureField && failureReason
          ? safeValidationMessage(failureField, failureReason, candidate.message)
          : undefined;
      return failureField && failureReason && failureMessage
        ? [{ field: failureField, reason: failureReason, message: failureMessage }]
        : [];
    });
    if (errors.length > 0) {
      output.errors = errors;
      const { errorCount } = input;
      output.errorCount =
        typeof errorCount === 'number' &&
        Number.isSafeInteger(errorCount) &&
        errorCount >= errors.length &&
        errorCount <= 10_000
          ? errorCount
          : errors.length;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function invalidParamsMessage(data: IMcpErrorData | undefined): string {
  const errors = Array.isArray(data?.errors)
    ? data.errors.filter((entry): entry is { field: string; reason: string; message: string } =>
        Boolean(entry && typeof entry === 'object' && typeof (entry as any).message === 'string'),
      )
    : [];
  if (errors.length > 0) {
    const errorCount = typeof data?.errorCount === 'number' ? data.errorCount : errors.length;
    const overflow = Math.max(0, errorCount - errors.length);
    const summary = errors.map((entry) => entry.message).join('; ') + (overflow ? ` (+${overflow} more)` : '');
    return `Invalid params: ${summary}`.slice(0, 2048);
  }
  const messagesByReason: Record<string, string> = {
    unknown_tool: 'Unknown tool',
    task_not_supported: 'Tool does not support tasks',
    task_required: 'Tool requires task-augmented execution',
    cursor_decode_failed: 'Invalid cursor',
    cursor_out_of_range: 'Invalid cursor',
  };
  return (typeof data?.reason === 'string' && messagesByReason[data.reason]) || 'Invalid params';
}

/**
 * Standard §13.3 / Appendix C.3 — decide what error text is safe to send to the client.
 *
 * A {@link BaseMcpError} carrying an explicit, developer-assigned `jsonRpcCode` (every class in
 * `specific-errors.ts`, plus domain tool errors) is intentional: its message was written to be
 * shown, so it is returned verbatim (with absolute paths still scrubbed). Anything else — an
 * unknown throw, a generic `Error`, or a `BaseMcpError` without an explicit code (becomes the
 * generic `-32603` / `-32000`) — may carry a stack frame, SQL fragment, internal module name or
 * connection string, so the outward message collapses to the opaque `Internal error`. Internal
 * logs retain only bounded identifiers (request id, error name and error code); raw messages and
 * stacks are deliberately excluded because they may contain credentials, PII or internal paths.
 */
export function sanitizeOutwardMessage(error: unknown): string {
  if (error instanceof BaseMcpError && typeof error.jsonRpcCode === 'number') {
    const message = stripSensitive(error.message).slice(0, 256);
    if (!/[\u0000-\u001f\u007f]/.test(message) && !UNSAFE_DATA_TEXT_RE.test(message)) {
      return message;
    }
    const fallbackByCode: Record<number, string> = {
      [-32602]: 'Invalid params',
      [-32002]: 'Resource not found',
      [-32003]: 'Rate limit exceeded',
      [-32004]: 'Operation timed out',
      [-32005]: 'Payload too large',
      [-32006]: 'Upstream unavailable',
      [-32007]: 'Conflict',
    };
    logInternalError(error, 'unsafe_domain_error');
    return fallbackByCode[error.jsonRpcCode] ?? 'Request failed';
  }
  logInternalError(error);
  return 'Internal error';
}

const SAFE_LOG_IDENTIFIER_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function safeLogIdentifier(value: unknown, fallback: string): string {
  return typeof value === 'string' && SAFE_LOG_IDENTIFIER_RE.test(value) ? value : fallback;
}

function safeErrorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== 'object' || !Object.hasOwn(error, 'code')) {
    return undefined;
  }
  const { code } = error as { code?: unknown };
  if (typeof code === 'number' && Number.isFinite(code)) {
    return code;
  }
  return typeof code === 'string' && SAFE_LOG_IDENTIFIER_RE.test(code) ? code : undefined;
}

/**
 * Write a secret-safe internal error summary. Never pass the original error object, message or
 * stack to the logger: logger-side masking is only a secondary safeguard and cannot recognize
 * every credential, email address, URL or vendor payload.
 */
export function logInternalError(error: unknown, context = 'internal_error'): void {
  const requestId = safeLogIdentifier(getCurrentRequestId(), 'no-request-id');
  const errorName = safeLogIdentifier(error instanceof Error ? error.name : undefined, 'UnknownError');
  const errorCode = safeErrorCode(error);
  const safeContext = safeLogIdentifier(context, 'internal_error');
  const summary =
    `[${requestId}] ${safeContext}: name=${errorName}` + (errorCode === undefined ? '' : ` code=${errorCode}`);
  try {
    logger.error(summary);
  } catch {
    // Error reporting must never replace the original failure (for example when a read-only
    // runtime prevents a lazily initialized file logger from opening its directory).
    try {
      process.stderr.write(`${summary}\n`);
    } catch {
      // Nothing else is safe to do here.
    }
  }
}

function buildErrorData(error: BaseMcpError): IMcpErrorData | undefined {
  let data = sanitizeErrorData(error.data ?? error.details);
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
    const safeMessages: Record<number, string> = {
      [-32700]: 'Parse error',
      [-32600]: 'Invalid Request',
      [-32601]: 'Method not found',
      [-32602]: 'Invalid params',
      [-32603]: 'Internal error',
      [-32000]: 'Server error',
      [-32002]: 'Resource not found',
      [-32003]: 'Rate limit exceeded',
      [-32004]: 'Operation timed out',
      [-32005]: 'Payload too large',
      [-32006]: 'Upstream unavailable',
      [-32007]: 'Conflict',
    };
    const code = Number.isInteger(error.code) ? error.code : -32603;
    if (code === -32603) {
      logInternalError(error, 'mcp_internal_error');
    }
    const data = sanitizeErrorData((error as any).data, code === -32602);
    const message = code === -32602 ? invalidParamsMessage(data) : (safeMessages[code] ?? 'Request failed');
    return new McpError(code, message, data);
  }
  const message = sanitizeOutwardMessage(error);
  if (error instanceof BaseMcpError && typeof error.jsonRpcCode === 'number') {
    return new McpError(error.jsonRpcCode, message, buildErrorData(error));
  }
  const requestId = getCurrentRequestId();
  return new McpError(-32603, message, requestId ? { requestId } : undefined);
}

export class ToolExecutionError extends BaseMcpError {
  constructor(_toolName: string, _message: string, printed?: boolean) {
    super('TOOL_EXECUTION_ERROR', 'Tool execution failed', undefined, 400, printed);
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
  const baseData = isMcpError ? sanitizeErrorData(error.data ?? error.details) : undefined;
  let mergedData = sanitizeErrorData(baseData || extraData ? { ...baseData, ...extraData } : undefined);

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
