import { BaseMcpError } from './BaseMcpError.js';

/**
 * Invalid request parameters. JSON-RPC `-32602` / HTTP 400 (matches the public-contract table).
 * The explicit `jsonRpcCode` also marks the message as developer-authored and safe, so it survives
 * outward sanitization (standard §13.3) instead of collapsing to the generic `Internal error`.
 */
export class ValidationError extends BaseMcpError {
  constructor(message: string, printed?: boolean) {
    super('VALIDATION_ERROR', message, undefined, 400, printed, -32602);
  }
}
