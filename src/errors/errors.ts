/**
 * Centralized error handling system for the MCP server
 */

import { BaseMcpError } from './BaseMcpError.js';

export class ToolExecutionError extends BaseMcpError {
  constructor (toolName: string, message: string, printed?: boolean) {
    super(
      'TOOL_EXECUTION_ERROR',
      `Failed to execute tool '${toolName}': ${message}`,
      undefined,
      400,
      printed,
    );
  }
}

export class SearchError extends BaseMcpError {
  constructor (entityType: string, message: string) {
    super(
      'SEARCH_ERROR',
      `Failed to search '${entityType}': ${message}`,
      undefined,
      400,
      true,
    );
  }
}

/**
 * Server-related errors
 */
export class ServerError extends BaseMcpError {
  constructor (message: string, details?: Record<string, unknown>, printed?: boolean) {
    super('SERVER_ERROR', message, details, 500, printed);
  }
}

/**
 * Create JSON-RPC 2.0 error response
 */
export function createJsonRpcErrorResponse (
  error: Error | BaseMcpError,
  requestId?: string | number | null,
): any {
  const isCustomError = error instanceof BaseMcpError;

  return {
    jsonrpc: '2.0',
    id: requestId ?? 1,
    error: {
      code: isCustomError ? (typeof error.code === 'number' ? error.code : -32000) : -32603,
      message: error.message,
      data: isCustomError && error.details !== undefined ? error.details : undefined,
    },
  };
}

export const toError = (err: any): Error => {
  return err instanceof Error ? err : new Error(String(err));
};

export const toStr = (err: any): string => {
  return err instanceof Error ? err.message : (err ? String(err) : 'Unknown error');
};

export const addErrorMessage = (err: any, msg: string) => {
  if (err instanceof Error) {
    err.message = `${msg}. ${err.message}`;
  }
};

