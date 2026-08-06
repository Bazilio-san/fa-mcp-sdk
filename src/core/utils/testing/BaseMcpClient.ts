// noinspection UnnecessaryLocalVariableJS

/**
 * Base MCP Client with common functionality
 *
 * Provides shared MCP methods that are identical across all transport implementations.
 * Transport-specific methods should be overridden in child classes.
 */
/** The per-request `_meta` keys every modern (2026-07-28) request carries. */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

export class BaseMcpClient {
  protected nextId = 1;
  protected customHeaders: Record<string, string>;
  /**
   * When true the client speaks protocol revision 2026-07-28: every request carries the
   * per-request `_meta` envelope and no `initialize` handshake is performed. When false (default)
   * the client speaks the legacy revision, exactly as before.
   */
  protected modern: boolean;
  protected clientCapabilities: Record<string, unknown>;
  protected clientInfo: { name: string; version: string };

  constructor(
    customHeaders: Record<string, string> = {},
    options: {
      modern?: boolean;
      clientCapabilities?: Record<string, unknown>;
      clientInfo?: { name: string; version: string };
    } = {},
  ) {
    this.customHeaders = customHeaders;
    this.modern = options.modern === true;
    this.clientCapabilities = options.clientCapabilities ?? {};
    this.clientInfo = options.clientInfo ?? { name: 'fa-mcp-sdk-test-client', version: '1.0.0' };
  }

  /** The `_meta` envelope of a modern request; empty object in legacy mode. */
  protected envelope(): Record<string, unknown> {
    if (!this.modern) {
      return {};
    }
    return {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientInfo': this.clientInfo,
        'io.modelcontextprotocol/clientCapabilities': this.clientCapabilities,
      },
    };
  }

  /** Every common method goes through here so the modern envelope is applied in one place. */
  protected async request(method: string, params: any = {}): Promise<any> {
    return this.sendRequest(method, { ...params, ...this.envelope() });
  }

  /**
   * Transport-specific request method - must be implemented by child classes
   */
  protected async sendRequest(_method: string, _params: any): Promise<any> {
    throw new Error('sendRequest must be implemented by child class');
  }

  /**
   * `server/discover` (2026-07-28) — supported protocol versions, capabilities and server
   * identity in one call. Modern era only; a legacy server answers with a method-not-found error.
   */
  async discover() {
    return this.request('server/discover', {});
  }

  /**
   * Close connection - base implementation (can be overridden)
   */
  async close(): Promise<void> {
    // Base implementation - can be overridden for specific transport needs
  }

  /**
   * Initialize connection - base implementation (can be overridden)
   */
  async initialize?(_params?: any): Promise<any> {
    // Base implementation - can be overridden for specific transport needs
  }

  // Common MCP methods - identical across all clients

  async listTools() {
    const result = await this.request('tools/list', {});
    return result;
  }

  async callTool(toolName: string, args: Record<string, any> = {}) {
    return this.request('tools/call', { name: toolName, arguments: args });
  }

  async listResources() {
    const result = await this.request('resources/list', {});
    return result;
  }

  async readResource(uri: string) {
    return this.request('resources/read', { uri });
  }

  async listPrompts() {
    const result = await this.request('prompts/list', {});
    return result;
  }

  async getPrompt(name: string, args: Record<string, any> = {}) {
    return this.request('prompts/get', { name, arguments: args });
  }

  /** Legacy era only — `ping` was removed from the core protocol in 2026-07-28. */
  async ping() {
    return this.request('ping', {});
  }
}
