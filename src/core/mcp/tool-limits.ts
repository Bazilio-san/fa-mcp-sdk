import { McpError } from '@modelcontextprotocol/sdk/types.js';

import { appConfig } from '../bootstrap/init-config.js';
import { MCP_ERROR_CODES } from '../errors/specific-errors.js';
import { TToolHandlerResponse, IToolHandlerStructuredResponse } from '../_types_/types.js';

/**
 * Race a tool invocation against `mcp.limits.toolTimeoutMs`. On expiry the returned promise
 * rejects with an SDK `McpError` carrying code `-32004` (standard §14 / Appendix B). The
 * pending tool promise is left running — Node.js cannot synchronously abort user code —
 * but the server-side timer is cleared so we don't leak handles. The HTTP-level transport
 * layer in `server-http.ts` runs its own race so the response status becomes 504.
 */
export async function withToolTimeout<T>(toolName: string, exec: () => Promise<T>): Promise<T> {
  const timeoutMs = appConfig.mcp.limits.toolTimeoutMs;
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new McpError(MCP_ERROR_CODES.TIMEOUT, `Tool '${toolName}' exceeded ${timeoutMs} ms timeout`, {
          reason: 'tool_timeout',
          retryAfter: 0,
        }),
      );
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });
  try {
    return await Promise.race([exec(), timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

const TRUNCATION_TAIL = '\n…[truncated]';

/**
 * Trim a tool response so its serialized payload stays under `mcp.limits.maxToolResultBytes`
 * (standard §12.2 / §14). Truncation is signalled BOTH in the textual content and in the
 * structured payload so the client cannot silently miss it.
 *
 * - For `content[].text` entries: the offending entry is cut to fit the budget and suffixed
 *   with an explicit `…[truncated]` marker.
 * - For `structuredContent`: a sibling `truncated: true` field is set when the JSON exceeds
 *   the budget, and the payload is replaced with a minimal sentinel object so the response
 *   still fits the wire frame.
 */
export function truncateToolResponse<T>(response: TToolHandlerResponse<T>): TToolHandlerResponse<T> {
  const maxBytes = appConfig.mcp.limits.maxToolResultBytes;
  if (!response || maxBytes <= 0) {
    return response;
  }

  // Structured response branch.
  if ('structuredContent' in response) {
    const structured = response as IToolHandlerStructuredResponse<any>;
    let serialized: string;
    try {
      serialized = JSON.stringify(structured.structuredContent ?? null);
    } catch {
      return response;
    }
    if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) {
      return response;
    }
    const replacement: any = {
      truncated: true,
      reason: 'max_tool_result_bytes_exceeded',
      maxBytes,
      originalBytes: Buffer.byteLength(serialized, 'utf8'),
    };
    return {
      ...structured,
      structuredContent: replacement,
    };
  }

  // Text content branch.
  if ('content' in response && Array.isArray(response.content)) {
    const sizes = response.content.map((p) => (p && p.type === 'text' ? Buffer.byteLength(p.text ?? '', 'utf8') : 0));
    const total = sizes.reduce((a, b) => a + b, 0);
    if (total <= maxBytes) {
      return response;
    }

    let budget = maxBytes;
    const newContent: typeof response.content = [];
    let truncatedFlag = false;
    for (const part of response.content) {
      if (!part || part.type !== 'text') {
        newContent.push(part);
        continue;
      }
      const bytes = Buffer.byteLength(part.text ?? '', 'utf8');
      if (bytes <= budget) {
        newContent.push(part);
        budget -= bytes;
        continue;
      }
      truncatedFlag = true;
      const sliceBytes = Math.max(0, budget - Buffer.byteLength(TRUNCATION_TAIL, 'utf8'));
      const buf = Buffer.from(part.text ?? '', 'utf8')
        .subarray(0, sliceBytes)
        .toString('utf8');
      newContent.push({ type: 'text', text: `${buf}${TRUNCATION_TAIL}` });
      budget = 0;
    }

    if (truncatedFlag) {
      return {
        ...(response as any),
        content: newContent,
        structuredContent: { truncated: true, reason: 'max_tool_result_bytes_exceeded', maxBytes },
      } as TToolHandlerResponse<T>;
    }
    return { ...(response as any), content: newContent };
  }

  return response;
}
