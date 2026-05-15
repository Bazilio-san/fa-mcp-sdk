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
