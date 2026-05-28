import { McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Standard §8.4 — server-side pagination for list-style methods.
 * Cursor is opaque base64 of the next offset. Items are sorted stably by the supplied key,
 * so subsequent calls with the same cursor always return the same element.
 */

export const DEFAULT_PAGE_SIZE = 100;

export function parsePageSize(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_PAGE_SIZE;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

function decodeCursor(cursor: string | undefined, total: number): number {
  if (cursor == null || cursor === '') {
    return 0;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64').toString('utf8');
  } catch {
    throw new McpError(-32602, 'Invalid cursor', { field: 'cursor', reason: 'cursor_decode_failed' });
  }
  const n = Number(decoded);
  if (!Number.isInteger(n) || n < 0 || n > total) {
    throw new McpError(-32602, 'Invalid cursor', { field: 'cursor', reason: 'cursor_out_of_range' });
  }
  return n;
}

export interface IPaginated<T> {
  page: T[];
  nextCursor?: string;
}

export function paginate<T>(
  items: T[],
  cursor: string | undefined,
  pageSize: number,
  sortKey: (item: T) => string,
): IPaginated<T> {
  const arr = Array.isArray(items) ? items.slice() : [];
  arr.sort((a, b) => {
    const ka = sortKey(a) ?? '';
    const kb = sortKey(b) ?? '';
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const offset = decodeCursor(cursor, arr.length);
  const end = Math.min(arr.length, offset + Math.max(1, pageSize));
  const page = arr.slice(offset, end);
  const result: IPaginated<T> = { page };
  if (end < arr.length) {
    result.nextCursor = encodeCursor(end);
  }
  return result;
}
