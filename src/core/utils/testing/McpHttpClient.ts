// noinspection UnnecessaryLocalVariableJS

import { BaseMcpClient } from './BaseMcpClient.js';

// noinspection UnnecessaryLocalVariableJS

type Json = any;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Json;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number;
  result: Json;
}

interface JsonRpcErrorObj {
  code: number;
  message: string;
  data?: Json;
}

interface JsonRpcErrorRes {
  jsonrpc: '2.0';
  id: number | null;
  error: JsonRpcErrorObj;
}

type JsonRpcMessage = JsonRpcSuccess | JsonRpcErrorRes | JsonRpcRequest;

/**
 * MCP Simple HTTP Client
 *
 * Uses simple POST requests instead of streaming HTTP for compatibility
 * with the current server implementation
 */
export class McpHttpClient extends BaseMcpClient {
  private readonly baseUrl: string;
  private readonly endpointPath: string;

  public serverInfo?: { name: string; version: string };
  public capabilities?: any;
  public protocolVersion?: string;

  constructor (baseUrl: string, options?: {
    endpointPath?: string; // e.g.: '/mcp'
    headers?: Record<string, string>;
    requestTimeoutMs?: number;
  }) {
    super(options?.headers ?? {});
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.endpointPath = options?.endpointPath ?? '/mcp';
  }

  override async initialize (params: {
    protocolVersion?: string;
    capabilities?: any;
    clientInfo?: { name: string; version: string };
  } = {}) {
    const res = await this.sendRpc('initialize', params);
    this.protocolVersion = res?.protocolVersion;
    this.capabilities = res?.capabilities;
    this.serverInfo = res?.serverInfo;

    // best-effort: notify the server about initialization
    this.notify('notifications/initialized', {});
    return res;
  }

  override async close () {
    // No persistent connection to close for simple HTTP client
  }

  private async sendHttpRequest (request: JsonRpcRequest): Promise<JsonRpcMessage> {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...this.customHeaders,
    } as Record<string, string>;

    const response = await fetch(`${this.baseUrl}${this.endpointPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as JsonRpcMessage;
    return result;
  }

  notify (method: string, params?: Json) {
    const req: JsonRpcRequest = { jsonrpc: '2.0', method, params };
    // Fire and forget for notifications
    this.sendHttpRequest(req).catch(() => {
      // Ignore errors for notifications
    });
  }

  async sendRpc<T = any> (method: string, params?: Json): Promise<T> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    const response = await this.sendHttpRequest(req);

    // Handle response
    if ((response as any).result !== undefined && typeof (response as any).id === 'number') {
      const { result } = response as JsonRpcSuccess;
      return result;
    }

    // Handle error response
    if ((response as any).error && 'id' in (response as any)) {
      const { error } = response as JsonRpcErrorRes;
      const err: any = new Error(`MCP Error ${error.code}: ${error.message}`);
      err.data = error.data;
      throw err;
    }

    throw new Error(`Invalid MCP response: ${JSON.stringify(response)}`);
  }

  // Override sendRequest to handle JSON-RPC requests
  protected override async sendRequest (method: string, params: any): Promise<any> {
    return this.sendRpc(method, params);
  }
}
