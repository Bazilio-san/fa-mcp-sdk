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

type JsonRpcMessage = JsonRpcSuccess | JsonRpcErrorRes | JsonRpcRequest; // allow incoming notifications

/**
 * MCP Streamable HTTP Client
 *
 * Supports a long-lived connection over HTTP (NDJSON),
 * multiple requests/responses and incoming notifications.
 */
export class McpStreamableHttpClient {
  private readonly baseUrl: string;
  private readonly endpointPath: string;
  private readonly customHeaders: Record<string, string>;
  private readonly requestTimeoutMs: number;

  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private outgoing!: ReadableStream<Uint8Array>;
  private response: Response | undefined;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private abort: AbortController | undefined;
  private readLoopPromise: Promise<void> | undefined;

  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer?: any }>();
  private notifications = new Map<string, Set<(params: any) => void>>();

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
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 120_000;
  }

  onNotification (method: string, handler: (params: any) => void) {
    if (!this.notifications.has(method)) {this.notifications.set(method, new Set());}
    this.notifications.get(method)!.add(handler);
    return () => this.notifications.get(method)!.delete(handler);
  }

  private emitNotification (method: string, params: any) {
    const set = this.notifications.get(method);
    if (!set) {return;}
    for (const fn of set) {
      try {
        fn(params);
      } catch { /* noop */
      }
    }
  }

  async connect () {
    if (this.response) {return;} // already connected

    this.abort = new AbortController();
    // create outgoing stream for writing NDJSON
    this.outgoing = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
      cancel: () => { /* ignore */
      },
    });

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...this.customHeaders,
    } as Record<string, string>;

    this.response = await fetch(`${this.baseUrl}${this.endpointPath}`, {
      method: 'POST',
      headers,
      body: this.outgoing,
      // @ts-ignore — required in Node for streaming request body
      duplex: 'half',
      signal: this.abort.signal,
    });

    if (!this.response.ok || !this.response.body) {
      const err = new Error(`Stream HTTP connect failed: ${this.response.status} ${this.response.statusText}`);
      this.cleanup();
      throw err;
    }

    this.reader = this.response.body.getReader();
    this.readLoopPromise = this.readLoop();
  }

  async initialize (params: {
    protocolVersion?: string;
    capabilities?: any;
    clientInfo?: { name: string; version: string };
  } = {}) {
    await this.connect();
    const res = await this.sendRpc('initialize', params);
    this.protocolVersion = res?.protocolVersion;
    this.capabilities = res?.capabilities;
    this.serverInfo = res?.serverInfo;

    // best-effort: notify the server about initialization, do not wait for a response
    this.notify('notifications/initialized', {});
    return res;
  }

  async close () {
    try {
      // attempt to gracefully finish writing
      try {
        this.controller?.close();
      } catch {
      }
      // reject all pending requests
      for (const [_id, p] of this.pending) {
        p.reject(new Error('Connection closed'));
      }
      this.pending.clear();
      // stop reading
      try {
        await this.reader?.cancel();
      } catch {
      }
      this.abort?.abort();
      await this.readLoopPromise?.catch(() => {
      });
    } finally {
      this.cleanup();
    }
  }

  private cleanup () {
    this.response = undefined;
    this.reader = undefined;
    this.readLoopPromise = undefined;
    this.abort = undefined;
  }

  private async readLoop () {
    let buffer = '';
    while (true) {
      const { done, value } = await this.reader!.read();
      if (done) {break;}
      buffer += this.decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const trimmed = line.trim();
        if (!trimmed) {continue;}
        let msg: JsonRpcMessage | undefined;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!msg) { continue; }
        this.routeIncoming(msg);
      }
    }
  }

  private routeIncoming (msg: JsonRpcMessage) {
    // response success
    if ((msg as any).result !== undefined && typeof (msg as any).id === 'number') {
      const { id, result } = msg as JsonRpcSuccess;
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.resolve(result);
      }
      return;
    }
    // response error
    if ((msg as any).error && 'id' in (msg as any)) {
      const { id, error } = msg as JsonRpcErrorRes;
      if (typeof id === 'number') {
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(id);
          const err: any = new Error(`MCP Error ${error.code}: ${error.message}`);
          err.data = error.data;
          pending.reject(err);
        }
      } else {
        // error without id — log as notification error
        this.emitNotification('error', error);
      }
      return;
    }
    // incoming request/notification
    if ((msg as any).method) {
      const { method, params } = msg as JsonRpcRequest;
      this.emitNotification(method, params);
    }
  }

  private writeNdjson (obj: object) {
    const chunk = this.encoder.encode(JSON.stringify(obj) + '\n');
    this.controller.enqueue(chunk);
  }

  notify (method: string, params?: Json) {
    const req: JsonRpcRequest = { jsonrpc: '2.0', method, params };
    this.writeNdjson(req);
  }

  async sendRpc<T = any> (method: string, params?: Json, timeoutMs = this.requestTimeoutMs): Promise<T> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    await this.connect();
    const p = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.writeNdjson(req);
    return p;
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
