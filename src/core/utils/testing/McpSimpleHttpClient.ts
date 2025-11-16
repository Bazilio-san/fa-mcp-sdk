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
export class McpSimpleHttpClient {
  private readonly baseUrl: string;
  private readonly endpointPath: string;
  private readonly customHeaders: Record<string, string>;

  private nextId = 1;

  public serverInfo?: { name: string; version: string };
  public capabilities?: any;
  public protocolVersion?: string;

  constructor (baseUrl: string, options?: {
    endpointPath?: string; // e.g.: '/mcp'
    headers?: Record<string, string>;
    requestTimeoutMs?: number;
  }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.endpointPath = options?.endpointPath ?? '/mcp';
    this.customHeaders = options?.headers ?? {};
  }

  async initialize (params: {
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

  async close () {
    // No persistent connection to close for simple HTTP client
  }

  private async sendRequest (request: JsonRpcRequest): Promise<JsonRpcMessage> {
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
    this.sendRequest(req).catch(() => {
      // Ignore errors for notifications
    });
  }

  async sendRpc<T = any> (method: string, params?: Json): Promise<T> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    const response = await this.sendRequest(req);

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

  // High-level MCP methods
  async listTools () {
    const res = await this.sendRpc('tools/list');
    return res?.tools ?? res;
  }

  async callTool (toolName: string, parameters: Record<string, any> = {}) {
    return this.sendRpc('tools/call', { name: toolName, arguments: parameters });
  }

  async listResources () {
    return this.sendRpc('resources/list');
  }

  async readResource (uri: string) {
    return this.sendRpc('resources/read', { uri });
  }

  async listPrompts () {
    return this.sendRpc('prompts/list');
  }

  async getPrompt (name: string, arguments_: Record<string, any> = {}) {
    return this.sendRpc('prompts/get', { name, arguments: arguments_ });
  }

  async ping () {
    return this.sendRpc('ping');
  }
}
