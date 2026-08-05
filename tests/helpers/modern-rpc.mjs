/**
 * Test helper: raw JSON-RPC calls in the 2026-07-28 (modern) wire shape — per-request `_meta`
 * envelope plus the required `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers.
 */

export const MODERN_VERSION = '2026-07-28';

export const modernMeta = (overrides = {}) => ({
  'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'modern-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
  ...overrides,
});

let nextId = 0;

/**
 * POST a single modern JSON-RPC request. Returns `{ status, json }` where `json` is the parsed
 * body (plain JSON or the first `data:` frame of an SSE response), or `{ status, text }` when the
 * body is empty / unparseable.
 */
export async function modernRpc(baseUrl, method, params = {}, options = {}) {
  const { name, headers = {}, meta = modernMeta(), id = ++nextId } = options;
  const body = {
    jsonrpc: '2.0',
    ...(id === null ? {} : { id }),
    method,
    params: { ...params, ...(meta ? { _meta: meta } : {}) },
  };
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MODERN_VERSION,
      'mcp-method': method,
      ...(name ? { 'mcp-name': name } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    const frame = text.split('\n').find((line) => line.startsWith('data:'));
    if (frame) {
      try {
        json = JSON.parse(frame.slice(5));
      } catch {
        /* leave null */
      }
    }
  }
  return { status: res.status, json, text };
}
