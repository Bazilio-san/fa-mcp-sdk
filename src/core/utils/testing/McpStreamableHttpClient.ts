import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { BaseMcpClient } from './BaseMcpClient.js';

type Json = any;

/**
 * MCP Streamable HTTP Client
 *
 * Thin wrapper around the official SDK `Client` + `StreamableHTTPClientTransport`. The SDK transport
 * handles the parts the server's `StreamableHTTPServerTransport` requires: the
 * `Accept: application/json, text/event-stream` header, capturing/resending `Mcp-Session-Id`,
 * protocol-version negotiation, SSE/JSON response parsing and a `DELETE` on close.
 *
 * The public surface (`listTools`, `callTool`, … via {@link BaseMcpClient}) is unchanged — only the
 * transport-level `sendRequest`/`initialize`/`close` are reimplemented.
 */
export class McpStreamableHttpClient extends BaseMcpClient {
  private readonly url: URL;
  private readonly requestTimeoutMs: number;
  private client: Client;
  private transport: StreamableHTTPClientTransport | undefined;

  public serverInfo: { name: string; version: string } | undefined;
  public capabilities: any;
  public protocolVersion: string | undefined;

  constructor(
    baseURL: string,
    options?: {
      endpointPath?: string; // e.g.: '/mcp'
      headers?: Record<string, string>;
      requestTimeoutMs?: number;
    },
  ) {
    super(options?.headers ?? {});
    this.url = new URL(options?.endpointPath ?? '/mcp', baseURL.replace(/\/$/, '') + '/');
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 120_000;
    this.client = new Client({ name: 'fa-mcp-test-client', version: '1.0.0' }, { capabilities: {} });
  }

  override async initialize(_params?: {
    protocolVersion?: string;
    capabilities?: any;
    clientInfo?: { name: string; version: string };
  }) {
    if (!this.transport) {
      this.transport = new StreamableHTTPClientTransport(this.url, {
        requestInit: { headers: this.customHeaders },
      });
      // `connect()` runs the full initialize handshake (+ notifications/initialized).
      // Cast: SDK `Transport` is stricter under `exactOptionalPropertyTypes`.
      await this.client.connect(this.transport as any);
    }
    const serverVersion = this.client.getServerVersion();
    if (serverVersion) {
      this.serverInfo = { name: serverVersion.name, version: serverVersion.version };
    }
    this.capabilities = this.client.getServerCapabilities();
    this.protocolVersion = (serverVersion as any)?.protocolVersion;
    return { protocolVersion: this.protocolVersion, capabilities: this.capabilities, serverInfo: this.serverInfo };
  }

  override async close() {
    await this.transport?.close(); // sends DELETE /mcp and tears down the session
    this.transport = undefined;
  }

  protected override async sendRequest(method: string, params: Json): Promise<any> {
    if (!this.transport) {
      await this.initialize();
    }
    // `ResultSchema` is the base passthrough result — accepts any MCP result without a strict schema.
    return this.client.request({ method, params } as any, ResultSchema as any, { timeout: this.requestTimeoutMs });
  }
}
