import { BaseMcpError, IMcpErrorData } from './BaseMcpError.js';

/**
 * MCP standard JSON-RPC error codes (Appendix B). These complement the generic JSON-RPC 2.0
 * codes (`-32600`, `-32601`, `-32602`, `-32603`) and identify MCP-specific failures.
 */
export const MCP_ERROR_CODES = {
  RATE_LIMITED: -32003,
  RESOURCE_NOT_FOUND: -32002,
  TIMEOUT: -32004,
  PAYLOAD_TOO_LARGE: -32005,
} as const;

/**
 * Body exceeds `mcp.limits.maxPayloadBytes`. Standard §14 / Appendix B.
 */
export class PayloadTooLargeError extends BaseMcpError {
  constructor(reason: string = 'Request body is too large', data?: IMcpErrorData) {
    super('PAYLOAD_TOO_LARGE', reason, undefined, 413, undefined, MCP_ERROR_CODES.PAYLOAD_TOO_LARGE, {
      reason,
      ...data,
    });
  }
}

/**
 * Tool execution exceeded `mcp.limits.toolTimeoutMs`. Standard §14 / Appendix B.
 */
export class TimeoutError extends BaseMcpError {
  constructor(reason: string = 'Operation timed out', data?: IMcpErrorData) {
    super('TIMEOUT', reason, undefined, 504, undefined, MCP_ERROR_CODES.TIMEOUT, { reason, ...data });
  }
}

/**
 * Per-client rate limit exceeded. Standard §14 / Appendix B.
 * The `retryAfter` value (seconds) MUST be mirrored in the HTTP `Retry-After` header.
 */
export class RateLimitedError extends BaseMcpError {
  constructor(reason: string, retryAfter: number, data?: IMcpErrorData) {
    super('RATE_LIMITED', reason, undefined, 429, undefined, MCP_ERROR_CODES.RATE_LIMITED, {
      reason,
      retryAfter,
      ...data,
    });
  }
}

/**
 * Session / resource not found. Standard §13 / Appendix B.
 */
export class ResourceNotFoundError extends BaseMcpError {
  constructor(reason: string = 'Resource not found', data?: IMcpErrorData) {
    super('RESOURCE_NOT_FOUND', reason, undefined, 404, undefined, MCP_ERROR_CODES.RESOURCE_NOT_FOUND, {
      reason,
      ...data,
    });
  }
}
