import { appConfig } from '../bootstrap/init-config.js';
import { isObject, ppj } from './utils.js';

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
export function formatToolResult (json: any): any {
  if (isObject(json)) {
    cleanUndefinedDeep(json);
  }

  return appConfig.mcp.toolAnswerAs === 'structuredContent'
    ? {
      structuredContent: json,
    }
    : {
      content: [
        {
          type: 'text',
          text: ppj(json),
        },
      ],
    };
}

export const getJsonFromResult = <T = any> (result: any): T => {
  if (appConfig.mcp.toolAnswerAs === 'structuredContent') {
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
