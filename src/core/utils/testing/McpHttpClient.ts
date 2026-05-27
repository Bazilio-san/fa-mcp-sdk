import { McpStreamableHttpClient } from './McpStreamableHttpClient.js';

/**
 * @deprecated Use {@link McpStreamableHttpClient}.
 *
 * The original plain-POST client (one-shot `POST /mcp`, `Accept: application/json`, no session) is
 * incompatible with the server's official `StreamableHTTPServerTransport`, which requires
 * `Accept: application/json, text/event-stream` and an `Mcp-Session-Id` round-trip. This is now a
 * thin alias over {@link McpStreamableHttpClient}, which speaks the correct protocol. The public
 * API (`initialize`, `listTools`, `callTool`, …) is unchanged.
 */
export class McpHttpClient extends McpStreamableHttpClient {}
