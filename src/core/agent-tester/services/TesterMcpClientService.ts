import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import crypto from 'crypto';
import chalk from 'chalk';
import { logger as lgr } from '../../logger.js';
import {
  TesterMcpConfig,
  ITesterCachedMcpClient,
  ITesterMcpTool,
  TesterMcpServerConfig,
  TesterMcpConnectionRequest,
  TesterMcpConnectionResponse,
  TesterHeaderRequirement,
} from '../types.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('agent-tester:mcp') });

export class TesterMcpClientService {
  private servers: Map<string, TesterMcpServerConfig> = new Map();
  private clients: Map<string, Client> = new Map();

  private clientCache: Map<string, ITesterCachedMcpClient> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

  constructor () {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleClients();
    }, 60 * 1000);
  }

  public getConnectionKey (config: TesterMcpConfig): string {
    const headersHash = this.hashObject(config.headers || {});
    return `${config.url}:${config.transport}:${headersHash}`;
  }

  private hashObject (obj: Record<string, string>): string {
    const sorted = Object.keys(obj).sort().map(k => `${k}=${obj[k]}`).join('&');
    return crypto.createHash('md5').update(sorted).digest('hex').slice(0, 8);
  }

  private cleanupStaleClients (): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.clientCache) {
      if (now - entry.lastUsed.getTime() > this.CACHE_MAX_AGE_MS) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const entry = this.clientCache.get(key);
      if (entry) {
        try {
          entry.client.close?.();
          logger.info(`Cleaned up stale client: ${key}`);
        } catch (e) {
          logger.warn(`Error closing stale client ${key}:`, e);
        }
        this.clientCache.delete(key);
      }
    }

    if (keysToDelete.length > 0) {
      logger.info(`Cleaned up ${keysToDelete.length} stale MCP clients`);
    }
  }

  public async getOrCreateClient (mcpConfig: TesterMcpConfig): Promise<ITesterCachedMcpClient> {
    const connectionKey = this.getConnectionKey(mcpConfig);

    const cached = this.clientCache.get(connectionKey);
    if (cached) {
      try {
        cached.lastUsed = new Date();
        logger.info(`Reusing cached MCP client: ${connectionKey}`);
        return cached;
      } catch {
        logger.info(`Cached client is dead, recreating: ${connectionKey}`);
        this.clientCache.delete(connectionKey);
      }
    }

    logger.info(`Creating new MCP client for: ${connectionKey}`);
    const client = await this.createMcpClientFromConfig(mcpConfig);

    const toolsList = await client.listTools();
    const tools: ITesterMcpTool[] = toolsList.tools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema,
    }));

    let agentPrompt: string | undefined;
    try {
      const prompts = await client.listPrompts();
      const agentPromptInfo = prompts.prompts.find((p: any) => p.name === 'agent_prompt');
      if (agentPromptInfo) {
        try {
          const promptData = await client.getPrompt({ name: 'agent_prompt' });
          const validMessages = promptData.messages.filter((m: any) =>
            m.role === 'user' || m.role === 'assistant',
          );
          agentPrompt = validMessages.map((m: any) => m.content.text).join('\n');
        } catch (promptDataError) {
          logger.info('Invalid agent_prompt format:', promptDataError);
        }
      }
    } catch (promptError) {
      logger.info('No agent_prompt available:', promptError);
    }

    const cachedClient: ITesterCachedMcpClient = {
      client,
      config: mcpConfig,
      tools,
      lastUsed: new Date(),
      connectionKey,
    };
    if (agentPrompt) {
      cachedClient.agentPrompt = agentPrompt;
    }

    this.clientCache.set(connectionKey, cachedClient);
    logger.info(`Cached new MCP client: ${connectionKey}, tools: ${tools.length}`);

    return cachedClient;
  }

  private async createMcpClientFromConfig (mcpConfig: TesterMcpConfig): Promise<Client> {
    const client = new Client({
      name: 'agent-tester',
      version: '1.0.0',
    });

    const baseUrl = new URL(mcpConfig.url);

    if (mcpConfig.transport === 'http') {
      logger.info(`Connecting via StreamableHTTPClientTransport to ${baseUrl}`);
      const safeHeaders = this.buildSafeHeaders(mcpConfig.headers);
      const transportOpts: any = {};
      if (safeHeaders) {
        transportOpts.requestInit = { headers: safeHeaders };
      }
      const transport = new StreamableHTTPClientTransport(baseUrl, transportOpts);
      await client.connect(transport as any);
      logger.info('Connected using Streamable HTTP transport');
    } else if (mcpConfig.transport === 'sse') {
      logger.info(`Connecting via SSEClientTransport to ${baseUrl}`);
      const safeHeaders = this.buildSafeHeaders(mcpConfig.headers);
      const transportOpts: any = {};
      if (safeHeaders) {
        transportOpts.eventSourceInit = { headers: safeHeaders };
        transportOpts.requestInit = { headers: safeHeaders };
      }
      const transport = new SSEClientTransport(baseUrl, transportOpts);
      await client.connect(transport as any);
      logger.info('Connected using SSE transport');
    } else {
      throw new Error(`Unsupported transport: ${mcpConfig.transport}`);
    }

    return client;
  }

  public async callToolWithConfig (mcpConfig: TesterMcpConfig, toolName: string, parameters: any): Promise<any> {
    const cached = await this.getOrCreateClient(mcpConfig);

    logger.info(`Calling tool ${toolName} via cached client`, { parameters });

    try {
      const result = await cached.client.callTool({
        name: toolName,
        arguments: parameters || {},
      });

      logger.info(`Tool ${toolName} executed successfully`);
      return result;
    } catch (error) {
      logger.error(`Failed to call tool ${toolName}:`, error);
      throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private buildSafeHeaders (headers?: Record<string, string>): Record<string, string> | undefined {
    if (!headers) {
      return undefined;
    }
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (v != null && String(v).trim() !== '') {
        result[k] = String(v);
      }
    }
    return Object.keys(result).length ? result : undefined;
  }

  public async getRequiredHeaders (serverUrl: string): Promise<TesterHeaderRequirement[]> {
    const existingEntry = Array.from(this.servers.values()).find(s => s.url === serverUrl && s.isConnected);
    if (existingEntry) {
      const client = this.clients.get(existingEntry.name);
      if (client) {
        const headers = await this.fetchRequiredHeadersUsing(client, serverUrl);
        if (headers.length > 0) {
          return headers;
        }
      }
    }

    const transport = /(\/mcp)$/i.test(serverUrl) ? 'http' : (/(\/sse)$/i.test(serverUrl) ? 'sse' : 'http');
    const tempName = `used-headers-${Math.random().toString(36).slice(2, 8)}`;

    const resp = await this.connectToServer({
      name: tempName,
      url: serverUrl,
      transport,
    });

    try {
      if (resp.success) {
        const client = this.clients.get(tempName);
        if (client) {
          const headers = await this.fetchRequiredHeadersUsing(client, serverUrl);
          if (headers.length > 0) {
            return headers;
          }
        }
      }
    } finally {
      try {
        await this.disconnectFromServer(tempName);
      } catch { /* ignore */
      }
    }

    return [];
  }

  private async fetchRequiredHeadersUsing (client: Client, serverUrl: string): Promise<TesterHeaderRequirement[]> {
    // 1) Try HTTP endpoint /used-http-headers
    try {
      const baseUrl = serverUrl.replace(/\/(mcp|sse)$/, '');
      const headersUrl = baseUrl + '/used-http-headers';
      logger.info(`Fetching used headers from: ${headersUrl}`);
      const response = await fetch(headersUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (response.ok) {
        const headers = await response.json();
        if (Array.isArray(headers)) {
          if (headers.length > 0) {
            logger.info(`Found ${headers.length} used headers from ${baseUrl}`);
          }
          return headers;
        }
      }
    } catch (e) {
      logger.info(`Headers endpoint failed for ${serverUrl}, fallback to MCP resource`, e);
    }

    // 2) Fallback: MCP resource use://http-headers
    try {
      const resource: any = await (client as any).readResource({ uri: 'use://http-headers' });
      const contents: any[] = Array.isArray(resource?.contents)
        ? resource.contents
        : (Array.isArray(resource) ? resource : []);

      let parsed: any = undefined;
      for (const c of contents) {
        const mime = (c?.mimeType || c?.mime_type || '').toLowerCase();
        const text = c?.text ?? c?.value ?? c?.data ?? undefined;
        if (mime === 'application/json' && typeof text === 'string') {
          try {
            parsed = JSON.parse(text);
          } catch { /* ignore */
          }
        } else if (typeof c === 'string') {
          try {
            parsed = JSON.parse(c);
          } catch { /* ignore */
          }
        } else if (typeof text === 'object' && text) {
          parsed = text;
        }
        if (parsed) {
          break;
        }
      }

      if (!parsed && typeof resource?.text === 'string') {
        try {
          parsed = JSON.parse(resource.text);
        } catch { /* ignore */
        }
      }

      const headerRequirements: TesterHeaderRequirement[] = Array.isArray(parsed) ? parsed : [];
      if (headerRequirements.length > 0) {
        logger.info(`Found ${headerRequirements.length} used headers via MCP resource use://http-headers`);
        return headerRequirements;
      }
    } catch (e: Error | any) {
      const em = e.message && e.message.includes('Unknown resource:')
        ? 'Unknown resource: use://http-headers'
        : e;
      logger.info(`Failed to fetch used headers via MCP resource for ${serverUrl}:`, em);
    }

    return [];
  }

  public async connectToServer (request: TesterMcpConnectionRequest): Promise<TesterMcpConnectionResponse> {
    try {
      logger.info(`Attempting to connect to MCP server: ${request.name} at ${request.url} via ${request.transport}`);

      let client: Client;
      try {
        client = await this.createMcpClient(request);

        const toolsList = await client.listTools();
        const tools = toolsList.tools.map(tool => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema,
        }));

        let agentPrompt: string | undefined;
        try {
          const prompts = await client.listPrompts();
          const agentPromptInfo = prompts.prompts.find(p => p.name === 'agent_prompt');
          if (agentPromptInfo) {
            try {
              const promptData = await client.getPrompt({ name: 'agent_prompt' });
              const validMessages = promptData.messages.filter((m) =>
                m.role === 'user' || m.role === 'assistant',
              );
              agentPrompt = validMessages.map((m: any) => m.content.text).join('\n');
            } catch (promptDataError) {
              logger.info(`Invalid agent_prompt format on ${request.name}:`, promptDataError);
            }
          }
        } catch (promptError) {
          logger.info(`No agent_prompt available on ${request.name}:`, promptError);
        }

        const serverConfig: TesterMcpServerConfig = {
          name: request.name,
          url: request.url,
          transport: request.transport,
          isConnected: true,
          tools,
          lastConnected: new Date(),
        };
        if (agentPrompt) {
          serverConfig.agentPrompt = agentPrompt;
        }
        if (request.headers) {
          serverConfig.headers = request.headers;
        }

        this.clients.set(request.name, client);
        this.servers.set(request.name, serverConfig);

        logger.info(`Successfully connected to MCP server: ${request.name}`, {
          toolCount: tools.length,
          hasAgentPrompt: !!agentPrompt,
          transport: request.transport,
        });

        return {
          success: true,
          config: serverConfig,
        };

      } catch (connectionError) {
        logger.error(`Failed to connect to MCP server ${request.name}:`, connectionError);

        const serverConfig: TesterMcpServerConfig = {
          name: request.name,
          url: request.url,
          transport: request.transport,
          isConnected: false,
          tools: [],
          connectionError: connectionError instanceof Error ? connectionError.message : 'Connection failed',
        };
        if (request.headers) {
          serverConfig.headers = request.headers;
        }

        this.servers.set(request.name, serverConfig);

        return {
          success: false,
          error: connectionError instanceof Error ? connectionError.message : 'Connection failed',
        };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Unexpected error connecting to MCP server ${request.name}:`, error);

      const serverConfig: TesterMcpServerConfig = {
        name: request.name,
        url: request.url,
        transport: request.transport,
        isConnected: false,
        tools: [],
        connectionError: errorMessage,
      };
      if (request.headers) {
        serverConfig.headers = request.headers;
      }

      this.servers.set(request.name, serverConfig);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private async createMcpClient (request: TesterMcpConnectionRequest): Promise<Client> {
    const client = new Client({
      name: 'agent-tester',
      version: '1.0.0',
    });

    const baseUrl = new URL(request.url);

    if (request.transport === 'http') {
      const safeHeaders = this.buildSafeHeaders(request.headers);
      const transportOpts: any = {};
      if (safeHeaders) {
        transportOpts.requestInit = { headers: safeHeaders };
      }
      const transport = new StreamableHTTPClientTransport(baseUrl, transportOpts);
      await client.connect(transport as any);
    } else if (request.transport === 'sse') {
      const safeHeaders = this.buildSafeHeaders(request.headers);
      const transportOpts: any = {};
      if (safeHeaders) {
        transportOpts.eventSourceInit = { headers: safeHeaders };
        transportOpts.requestInit = { headers: safeHeaders };
      }
      const transport = new SSEClientTransport(baseUrl, transportOpts);
      await client.connect(transport as any);
    } else {
      throw new Error(`Unsupported transport: ${request.transport}`);
    }

    return client;
  }

  public async disconnectFromServer (serverName: string): Promise<void> {
    logger.info(`Disconnecting from MCP server: ${serverName}`);

    const client = this.clients.get(serverName);
    if (client) {
      try {
        await client.close();
        logger.info(`Closed connection to ${serverName}`);
      } catch (error) {
        logger.error(`Error closing connection to ${serverName}:`, error);
      }
      this.clients.delete(serverName);
    }

    const serverConfig = this.servers.get(serverName);
    if (serverConfig) {
      serverConfig.isConnected = false;
      serverConfig.connectionError = 'Manually disconnected';
    }
  }

  public async updateHeaders (serverName: string, headers: Record<string, string>): Promise<TesterMcpConnectionResponse> {
    const config = this.servers.get(serverName);
    if (!config) {
      return { success: false, error: `Server ${serverName} not found` };
    }

    config.headers = { ...headers };

    try {
      try {
        await this.disconnectFromServer(serverName);
      } catch {
      }

      const response = await this.connectToServer({
        name: config.name,
        url: config.url,
        transport: config.transport as 'http' | 'sse',
        headers: config.headers,
      });

      return response;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update headers';
      return { success: false, error: msg };
    }
  }

  public getAllServerConfigs (): TesterMcpServerConfig[] {
    return Array.from(this.servers.values());
  }

  public async cleanup (): Promise<void> {
    logger.info('Cleaning up MCP connections');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const [key, entry] of this.clientCache.entries()) {
      try {
        await entry.client.close?.();
        logger.info(`Closed cached client: ${key}`);
      } catch (error) {
        logger.error(`Error closing cached client ${key}:`, error);
      }
    }
    this.clientCache.clear();

    for (const [serverName, client] of this.clients.entries()) {
      try {
        await client.close();
        logger.info(`Closed connection to ${serverName}`);
      } catch (error) {
        logger.error(`Error closing connection to ${serverName}:`, error);
      }
    }

    this.clients.clear();
    this.servers.clear();
  }
}
