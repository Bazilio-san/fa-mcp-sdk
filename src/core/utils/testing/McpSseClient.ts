import { getJsonFromResult } from '../../index.js';
import { BaseMcpClient } from './BaseMcpClient.js';

// Global unhandled rejection handler setup for npm package usage
// This prevents PromiseRejectionHandledWarning messages during error testing
function setupGlobalRejectionHandler () {
  if (!(global as any)._faMcpSdkRejectionHandler) {
    (global as any)._faMcpSdkRejectionHandler = true;

    // Track rejected promises that we've handled to prevent warnings
    const handledPromises = new WeakSet<Promise<any>>();

    // Override unhandledRejection to track MCP-related rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      // Check if this is an MCP-related error or network error from our client
      const isMcpError = typeof reason === 'object' && (
        reason?.message?.includes('MCP Error:') ||
        reason?.message?.includes('SQL validation failed') ||
        reason?.message?.includes('fetch failed') ||
        reason?.method // Our custom method property
      );

      if (isMcpError) {
        // Mark this promise as handled to prevent future warnings
        handledPromises.add(promise);

        // Attach a silent handler to prevent Node.js warning
        promise.catch(() => {
          // Silently handle - the error will be caught by the user's try-catch
        });
      }
    });

    // Override rejectionHandled to prevent warnings for promises we've marked
    process.on('rejectionHandled', (promise: Promise<any>) => {
      // If we marked this promise as handled, suppress the warning
      if (handledPromises.has(promise)) {
        // Suppress the warning by not letting Node.js handle it
        return;
      }
      // For other promises, let Node.js handle normally
    });

    // Override console.warn to filter out PromiseRejectionHandledWarning for our promises
    const originalWarn = console.warn;
    console.warn = function (...args: any[]) {
      // Check if this is a PromiseRejectionHandledWarning
      if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('PromiseRejectionHandledWarning')) {
        // Suppress the warning - we've already handled these promises properly
        return;
      }
      // For other warnings, use original behavior
      return originalWarn.apply(this, args);
    };
  }
}

// Auto-setup the handler when module is imported (for npm package usage)
setupGlobalRejectionHandler();

async function safeReadText (res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    return text?.slice(0, 1000);
  } catch {
    return undefined;
  }
}

/**
 * MCP SSE Client for testing (improved)
 *
 * Keeps a single long-lived SSE connection for receiving responses
 * and sends JSON-RPC requests as separate HTTP POSTs to /rpc.
 * Supports routing by id and per-operation timeouts.
 */
export class McpSseClient extends BaseMcpClient {
  private readonly baseUrl: string;
  private requestId: number;

  // SSE connection state
  private sseAbort?: AbortController | undefined;
  private sseReaderTask?: Promise<void>;
  private connected = false;

  // pending requests awaiting response by id
  private pending = new Map<number, {
    resolve: (value: any) => void,
    reject: (reason?: any) => void,
    timeout: any,
    method: string,
  }>();

  constructor (baseUrl: string, customHeaders: Record<string, string> = {}) {
    super(customHeaders);
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.requestId = 1;
  }

  /** Public API: close SSE and reject all pending */
  override async close () {
    this.connected = false;
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = undefined;
    }
    // Reject all pending
    const err = new Error('MCP SSE client closed');
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timeout);
      entry.reject(err);
      this.pending.delete(id);
    }
    // Wait reader to finish
    await this.sseReaderTask?.catch(() => {
    });
  }

  /** Ensure SSE stream established */
  private async ensureConnected () {
    if (this.connected) {
      return;
    }
    await this.connect();
  }

  /** Open SSE stream via fetch and start reader loop */
  private async connect () {
    if (this.connected) {
      return;
    }
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      ...this.customHeaders,
    };

    this.sseAbort = new AbortController();
    const url = `${this.baseUrl}/sse`;

    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: this.sseAbort.signal,
    } as any);

    if (!res.ok || !res.body) {
      const text = await safeReadText(res);
      throw new Error(`Failed to open SSE stream: ${res.status} ${res.statusText}${text ? ' - ' + text : ''}`);
    }

    this.connected = true;
    this.sseReaderTask = this.readSseLoop(res.body);
    // detach errors to console but keep state clean
    this.sseReaderTask.catch(err => {
      this.connected = false;
      // Reject all pending on fatal SSE error
      for (const [id, entry] of this.pending.entries()) {
        clearTimeout(entry.timeout);
        entry.reject(err);
        this.pending.delete(id);
      }
    });
  }

  /** Parse SSE stream and dispatch messages by JSON-RPC id */
  private async readSseLoop (body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by double newline
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleSseEvent(rawEvent);
        }
      }
    } finally {
      // flush tail
      const tail = decoder.decode();
      if (tail) {
        buffer += tail;
      }
      if (buffer.trim()) {
        this.handleSseEvent(buffer);
      }
      this.connected = false;
    }
  }

  /** Handle one SSE event block (multiple lines). Parse data: lines only */
  private handleSseEvent (eventBlock: string) {
    // eventBlock may contain comments ": ..." and other fields
    const lines = eventBlock.split(/\r?\n/);
    let dataLines: string[] = [];
    for (const line of lines) {
      if (!line) {
        continue;
      }
      if (line.startsWith(':')) {
        continue;
      } // comment/keepalive
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
      // we ignore id:, event:, retry: for now (not required for simple tests)
    }
    if (dataLines.length === 0) {
      return;
    }
    const dataStr = dataLines.join('\n');
    let payload: any;
    try {
      payload = JSON.parse(dataStr);
    } catch {
      // non-JSON data frames are ignored in tests
      return;
    }
    const id = payload?.id;
    if (id == null) {
      // broadcast/notification — ignore in this test client
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      // late/unknown id — ignore silently for tests
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    if (payload.error) {
      const errorMessage = payload.error?.message || 'Unknown error';
      // In test environment, log validation errors but don't crash
      if (errorMessage.includes('invalid_type')) {
        console.log(`  ⚠️  Parameter validation error: ${errorMessage}`);
        pending.resolve(null);
        return;
      }
      // For tool execution errors, we want to throw them so tests can verify expected failures
      if (errorMessage.includes('Failed to execute tool')) {
        console.log(`  ⚠️  Error: ${errorMessage}`);
        const err = new Error(`MCP Error: ${errorMessage}`);
        (err as any).data = payload.error?.data;
        (err as any).fullMcpResponse = payload;
        (err as any).method = pending.method; // Attach method for error handling
        pending.reject(err);
        return;
      }
      const err = new Error(`MCP Error: ${errorMessage}`);
      (err as any).data = payload.error?.data;
      (err as any).fullMcpResponse = payload;
      (err as any).method = pending.method; // Attach method for error handling
      // Use setImmediate to avoid synchronous rejection that can cause unhandledRejection
      setImmediate(() => {
        pending.reject(err);
      });
    } else {
      const res = getJsonFromResult(payload.result);
      if (res?.message) {
        console.log('  message:', res.message);
      }
      pending.resolve(payload.result);
    }
  }

  /**
   * Send JSON-RPC request over HTTP; await response via SSE stream
   */
  protected override async sendRequest (method: string, params: Record<string, any> = {}): Promise<any> {
    await this.ensureConnected();

    const id = this.requestId++;
    const request = { jsonrpc: '2.0', id, method, params };

    // Prepare promise and timeout
    const opTimeoutMs = 30000;
    let timeoutRef: any;
    const promise = new Promise<any>((resolve, reject) => {
      timeoutRef = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout for method: ${method}`));
      }, opTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout: timeoutRef, method });
    });

    // Fire-and-wait: POST to /sse
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.customHeaders,
    };
    try {
      const res = await fetch(`${this.baseUrl}/sse`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      } as any);

      if (!res.ok) {
        clearTimeout(timeoutRef);
        this.pending.delete(id);
        const text = await safeReadText(res);
        const error = new Error(`RPC send failed: ${res.status} ${res.statusText}${text ? ' - ' + text : ''}`);
        // Attach method info for better error handling
        (error as any).method = method;
        throw error;
      }
    } catch (fetchError: any) {
      // Handle fetch errors and clean up pending request
      clearTimeout(timeoutRef);
      this.pending.delete(id);
      // Preserve method information for error handling
      fetchError.method = method;
      throw fetchError;
    }

    // Handle promise immediately to prevent unhandled rejections
    return promise.then(
      (result) => result,
      (error: any) => {
        // Ensure method info is available
        if (!error.method) {
          error.method = method;
        }
        // Re-throw synchronously to prevent async rejection warnings
        throw error;
      },
    );
  }

  async health () {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }
}
