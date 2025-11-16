// noinspection UnnecessaryLocalVariableJS

/**
 * Base MCP Client with common functionality
 *
 * Provides shared MCP methods that are identical across all transport implementations.
 * Transport-specific methods should be overridden in child classes.
 */
export class BaseMcpClient {
  protected nextId = 1;
  protected customHeaders: Record<string, string>;

  constructor (customHeaders: Record<string, string> = {}) {
    this.customHeaders = customHeaders;
  }

  /**
   * Transport-specific request method - must be implemented by child classes
   */
  protected async sendRequest (_method: string, _params: any): Promise<any> {
    throw new Error('sendRequest must be implemented by child class');
  }

  /**
   * Close connection - base implementation (can be overridden)
   */
  async close (): Promise<void> {
    // Base implementation - can be overridden for specific transport needs
  }

  /**
   * Initialize connection - base implementation (can be overridden)
   */
  async initialize? (_params?: any): Promise<any> {
    // Base implementation - can be overridden for specific transport needs
  }

  // Common MCP methods - identical across all clients

  async listTools () {
    const result = await this.sendRequest('tools/list', {});
    return result;
  }

  async callTool (toolName: string, args: Record<string, any> = {}) {
    return this.sendRequest('tools/call', { name: toolName, arguments: args });
  }

  async listResources () {
    const result = await this.sendRequest('resources/list', {});
    return result;
  }

  async readResource (uri: string) {
    return this.sendRequest('resources/read', { uri });
  }

  async listPrompts () {
    const result = await this.sendRequest('prompts/list', {});
    return result;
  }

  async getPrompt (name: string, args: Record<string, any> = {}) {
    return this.sendRequest('prompts/get', { name, arguments: args });
  }

  async ping () {
    return this.sendRequest('ping', {});
  }
}
