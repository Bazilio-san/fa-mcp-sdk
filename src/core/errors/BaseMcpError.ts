/**
 * Canonical shape of `error.data` per MCP standard (Appendix B.3).
 * - `requestId`: correlation id (will surface as X-Request-Id once Phase 7 lands).
 * - `field` / `reason`: validation diagnostics.
 * - `retryAfter`: seconds until the next attempt is allowed (rate-limit `-32003`).
 *
 * Additional implementation-specific keys are allowed via the index signature, but the four
 * canonical keys above MUST be honoured by every transport.
 */
export interface IMcpErrorData {
  requestId?: string;
  field?: string;
  reason?: string;
  retryAfter?: number;
  [key: string]: unknown;
}

interface IMcpError {
  code: string;
  message: string;
  data?: IMcpErrorData;
  /** @deprecated Legacy free-form payload. Prefer the structured `data` field above. */
  details?: Record<string, unknown>;
  stack?: string;
}

/**
 * Base error class for all MCP errors
 */
export class BaseMcpError extends Error implements IMcpError {
  public readonly code: string;
  public readonly data?: IMcpErrorData;
  public readonly details?: Record<string, unknown>;
  public readonly statusCode: number;
  public readonly jsonRpcCode?: number;
  public readonly printed?: boolean;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    statusCode?: number,
    printed?: boolean,
    jsonRpcCode?: number,
    data?: IMcpErrorData,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    } else {
      // @ts-ignore
      delete this.details;
    }
    if (data !== undefined) {
      this.data = data;
    } else {
      // @ts-ignore
      delete this.data;
    }
    this.statusCode = statusCode || 500;
    if (jsonRpcCode !== undefined) {
      this.jsonRpcCode = jsonRpcCode;
    } else {
      // @ts-ignore
      delete this.jsonRpcCode;
    }
    if (printed) {
      this.printed = true;
    } else {
      // @ts-ignore
      delete this.printed;
    }

    // Maintain proper stack trace for V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): IMcpError {
    const result: IMcpError = {
      code: this.code,
      message: this.message,
    };

    if (this.data !== undefined) {
      result.data = this.data;
    }

    if (this.details !== undefined) {
      result.details = this.details;
    }

    if (this.stack !== undefined) {
      result.stack = this.stack;
    }

    return result;
  }
}
