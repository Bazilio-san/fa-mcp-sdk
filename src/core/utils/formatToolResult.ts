import { appConfig } from '../bootstrap/init-config.js';

import { isObject, ppj } from './utils.js';
import { IToolHandlerStructuredResponse, IToolHandlerTextResponse, TToolHandlerResponse } from '../_types_/types.js';

const cleanUndefinedDeep = (value: any): void => {
  if (!isObject(value)) {
    return;
  }
  // Do not attempt to clean special objects like Date
  if (value instanceof Date) {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const el = value[i];
      if (isObject(el)) {
        cleanUndefinedDeep(el);
      }
      // Note: We intentionally do not remove undefined array elements to preserve indices
    }
    return;
  }
  // Plain object case
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (v === undefined) {
      delete value[key];
    } else if (isObject(v)) {
      cleanUndefinedDeep(v);
    }
  }
};

/**
 * Format tool result based on configuration
 * Returns either structured content (JSON) or formatted text
 */
export function asTextContent(text: string): IToolHandlerTextResponse {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

/**
 * Format tool result based on configuration
 * Returns either structured content (JSON) or formatted text
 */
export function asJson<T = any>(json: T): IToolHandlerStructuredResponse<T> {
  if (isObject(json)) {
    cleanUndefinedDeep(json);
  }
  return { structuredContent: json };
}

/**
 * Format tool result based on configuration
 * Returns either structured content (JSON) or formatted text
 */
export function formatToolResult<T = any>(json: T): TToolHandlerResponse<T> {
  if (appConfig.mcp.tools.answerAs === 'structuredContent') {
    return asJson<T>(json) as IToolHandlerStructuredResponse<T>;
  }
  if (isObject(json)) {
    cleanUndefinedDeep(json);
  }
  if (typeof json === 'string') {
    return asTextContent(json) as IToolHandlerTextResponse;
  }
  return asTextContent(ppj(json));
}

/**
 * Text response with `isError: true`. Use for tool-level errors that the LLM
 * should see and react to (resource not found, business validation failed,
 * upstream API returned 404, etc.). Per MCP spec these MUST NOT be thrown as
 * JSON-RPC errors — throwing turns them into protocol-level failures the LLM
 * cannot self-correct from.
 *
 * @example
 * if (!issue) {
 *   return asTextError(`Issue ${key} not found`);
 * }
 */
export function asTextError(text: string): IToolHandlerTextResponse {
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

/**
 * Structured (`structuredContent`) response with `isError: true`. See
 * {@link asTextError} for when to use error responses vs throwing.
 */
export function asJsonError<T = any>(json: T): IToolHandlerStructuredResponse<T> {
  if (isObject(json)) {
    cleanUndefinedDeep(json);
  }
  return { structuredContent: json, isError: true };
}

/**
 * Config-aware tool error formatter — mirror of {@link formatToolResult} but
 * sets `isError: true`. Honors `appConfig.mcp.tools.answerAs` so error
 * responses follow the same shape as success responses for the same MCP.
 *
 * Use this for tool-level errors the LLM should see (not-found, validation,
 * upstream failure). Reserve `throw new ToolExecutionError(...)` for protocol
 * issues: unknown tool, malformed call, missing transport feature.
 *
 * @example
 * try {
 *   const data = await fetchIssue(key);
 *   return formatToolResult(data);
 * } catch (err) {
 *   if (err.code === 'NOT_FOUND') {
 *     return formatToolError(`Issue ${key} not found`);
 *   }
 *   throw err; // genuine infra failure → JSON-RPC error is appropriate
 * }
 */
export function formatToolError<T = any>(json: T): TToolHandlerResponse<T> {
  if (appConfig.mcp.tools.answerAs === 'structuredContent') {
    return asJsonError<T>(json);
  }
  if (isObject(json)) {
    cleanUndefinedDeep(json);
  }
  const text = typeof json === 'string' ? json : ppj(json);
  return asTextError(text);
}

export const getJsonFromResult = <T = any>(result: any): T => {
  if (appConfig.mcp.tools.answerAs === 'structuredContent') {
    return result?.structuredContent as T;
  } else {
    const text = result?.result?.content?.[0]?.text || result?.content?.[0]?.text || '';
    try {
      return JSON.parse(text) as T;
    } catch {
      //
    }
  }
  return undefined as T;
};
