import crypto from 'crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import chalk from 'chalk';

import { appConfig } from '../../bootstrap/init-config.js';
import { generateToken } from '../../auth/jwt.js';
import { canLocallyIssueJwt } from '../../auth/key-resolver.js';
import { logInternalError } from '../../errors/errors.js';
import { logger as lgr } from '../../logger.js';
import { MCP_APPS_EXTENSION_ID, MCP_APPS_RESOURCE_MIME_TYPE } from '../../mcp/mcp-apps.js';
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

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleClients();
    }, 60 * 1000);
  }

  public getConnectionKey(config: TesterMcpConfig): string {
    const headersHash = this.hashObject(config.headers || {});
    const appFlag = config.appMode ? 'app' : 'plain';
    return `${config.url}:${config.transport}:${headersHash}:${appFlag}`;
  }

  private buildClientCapabilities(appMode: boolean | undefined): Record<string, any> {
    if (!appMode) {
      return {};
    }
    return {
      capabilities: {
        extensions: {
          [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APPS_RESOURCE_MIME_TYPE] },
        },
      },
    };
  }

  private hashObject(obj: Record<string, string>): string {
    const sorted = Object.keys(obj)
      .sort()
      .map((k) => `${k}=${obj[k]}`)
      .join('&');
    return crypto.createHash('md5').update(sorted).digest('hex').slice(0, 8);
  }

  private cleanupStaleClients(): void {
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
          logger.info('Cleaned up stale MCP client');
        } catch (e) {
          logInternalError(e, 'agent_tester_stale_client_close');
        }
        this.clientCache.delete(key);
      }
    }

    if (keysToDelete.length > 0) {
      logger.info(`Cleaned up ${keysToDelete.length} stale MCP clients`);
    }
  }

  public async getOrCreateClient(mcpConfig: TesterMcpConfig): Promise<ITesterCachedMcpClient> {
    const connectionKey = this.getConnectionKey(mcpConfig);

    const cached = this.clientCache.get(connectionKey);
    if (cached) {
      try {
        cached.lastUsed = new Date();
        logger.info('Reusing cached MCP client');
        return cached;
      } catch {
        logger.info('Cached MCP client is unavailable; recreating');
        this.clientCache.delete(connectionKey);
      }
    }

    logger.info('Creating new MCP client');
    const client = await this.createMcpClientFromConfig(mcpConfig);

    const toolsList = await client.listTools();
    const tools: ITesterMcpTool[] = toolsList.tools.map((tool) => {
      const t: ITesterMcpTool = {
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema,
      };
      const meta = (tool as any)._meta;
      if (meta && typeof meta === 'object') {
        t._meta = meta;
      }
      return t;
    });

    let agentPrompt: string | undefined;
    try {
      const prompts = await client.listPrompts();
      const agentPromptInfo = prompts.prompts.find((p: any) => p.name === 'agent_prompt');
      if (agentPromptInfo) {
        try {
          const promptData = await client.getPrompt({ name: 'agent_prompt' });
          const validMessages = promptData.messages.filter((m: any) => m.role === 'user' || m.role === 'assistant');
          agentPrompt = validMessages.map((m: any) => m.content.text).join('\n');
        } catch (promptDataError) {
          logInternalError(promptDataError, 'agent_tester_prompt_format');
        }
      }
    } catch (promptError) {
      logInternalError(promptError, 'agent_tester_prompt_unavailable');
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
    logger.info(`Cached new MCP client: tools=${tools.length}`);

    return cachedClient;
  }

  private async createMcpClientFromConfig(mcpConfig: TesterMcpConfig): Promise<Client> {
    const client = new Client(
      { name: 'agent-tester', version: '1.0.0' },
      this.buildClientCapabilities(mcpConfig.appMode),
    );

    const baseURL = new URL(mcpConfig.url);

    if (mcpConfig.transport === 'http') {
      logger.info('Connecting via Streamable HTTP transport');
      const safeHeaders = this.buildSafeHeaders(mcpConfig.headers);
      const transportOpts: any = {};
      if (safeHeaders) {
        transportOpts.requestInit = { headers: safeHeaders };
      }
      const transport = new StreamableHTTPClientTransport(baseURL, transportOpts);
      await client.connect(transport as any);
      logger.info('Connected using Streamable HTTP transport');
    } else if (mcpConfig.transport === 'sse') {
      logger.info('Connecting via SSE transport');
      const safeHeaders = this.buildSafeHeaders(mcpConfig.headers);
      const transportOpts: any = {};
      if (safeHeaders) {
        transportOpts.eventSourceInit = { headers: safeHeaders };
        transportOpts.requestInit = { headers: safeHeaders };
      }
      const transport = new SSEClientTransport(baseURL, transportOpts);
      await client.connect(transport as any);
      logger.info('Connected using SSE transport');
    } else {
      throw new Error(`Unsupported transport: ${mcpConfig.transport}`);
    }

    return client;
  }

  public async callToolWithConfig(mcpConfig: TesterMcpConfig, toolName: string, parameters: any): Promise<any> {
    const parameterShape =
      parameters && typeof parameters === 'object' && !Array.isArray(parameters)
        ? Object.fromEntries(
            Object.entries(parameters).map(([key, value]) => [key, Array.isArray(value) ? 'array' : typeof value]),
          )
        : { root: Array.isArray(parameters) ? 'array' : typeof parameters };
    logger.info(`Calling tool ${toolName} via cached client; parameterShape=${JSON.stringify(parameterShape)}`);

    const timeout = appConfig.agentTester?.toolCallTimeoutMs ?? 60000;

    const invoke = async () => {
      const cached = await this.getOrCreateClient(mcpConfig);
      return cached.client.callTool(
        {
          name: toolName,
          arguments: parameters || {},
        },
        undefined,
        { timeout },
      );
    };

    try {
      const result = await invoke();
      logger.info(`Tool ${toolName} executed successfully`);
      return result;
    } catch (error) {
      if (this.isAuthError(error) && (await this.reissueOwnJwt(mcpConfig))) {
        logger.warn(`Tool ${toolName}: 401 received, JWT reissued, retrying once`);
        try {
          const result = await invoke();
          logger.info(`Tool ${toolName} executed successfully after retry`);
          return result;
        } catch (retryError) {
          logInternalError(retryError, 'agent_tester_tool_retry');
          throw new Error('Tool execution failed', { cause: retryError });
        }
      }
      logInternalError(error, 'agent_tester_tool_call');
      throw new Error('Tool execution failed', { cause: error });
    }
  }

  private isAuthError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /\b401\b|unauthorized/i.test(msg);
  }

  private isOwnMcpUrl(url: string): boolean {
    try {
      const u = new URL(url);
      const port = u.port || (u.protocol === 'https:' ? '443' : '80');
      const ownPort = String(appConfig.webServer?.port ?? '');
      if (!ownPort || port !== ownPort) {
        return false;
      }
      const host = u.hostname.toLowerCase();
      const ownHost = (appConfig.webServer?.host ?? '').toLowerCase();
      const localHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
      return localHosts.has(host) || (!!ownHost && host === ownHost);
    } catch {
      return false;
    }
  }

  // Reissue a JWT for our own server when the cached Authorization header has expired.
  // Returns true if the header was rewritten and the cached client purged — caller may retry once.
  // Skips when we cannot sign locally (e.g. mode=remoteJwks delegates issuance to external IdP).
  private async reissueOwnJwt(mcpConfig: TesterMcpConfig): Promise<boolean> {
    const auth = appConfig.webServer?.auth;
    if (!auth?.enabled || !canLocallyIssueJwt()) {
      return false;
    }
    if (!this.isOwnMcpUrl(mcpConfig.url)) {
      return false;
    }
    const headers = mcpConfig.headers || {};
    const headerKey =
      'Authorization' in headers ? 'Authorization' : 'authorization' in headers ? 'authorization' : null;
    if (!headerKey) {
      return false;
    }
    if (!/^Bearer\s+/i.test(headers[headerKey] || '')) {
      return false;
    }

    const ttlSec = appConfig.agentTester?.tokenTTLSec ?? 1800;
    const jwt = await generateToken('agentTester', ttlSec, { service: appConfig.name });

    const oldKey = this.getConnectionKey(mcpConfig);
    const oldEntry = this.clientCache.get(oldKey);
    if (oldEntry) {
      try {
        oldEntry.client.close?.();
      } catch {
        /* ignore */
      }
      this.clientCache.delete(oldKey);
    }

    if (!mcpConfig.headers) {
      mcpConfig.headers = {};
    }
    mcpConfig.headers[headerKey] = `Bearer ${jwt}`;
    return true;
  }

  private buildSafeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
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

  public async getRequiredHeaders(serverUrl: string): Promise<TesterHeaderRequirement[]> {
    const existingEntry = Array.from(this.servers.values()).find((s) => s.url === serverUrl && s.isConnected);
    if (existingEntry) {
      const client = this.clients.get(existingEntry.name);
      if (client) {
        const headers = await this.fetchRequiredHeadersUsing(client, serverUrl);
        if (headers.length > 0) {
          return headers;
        }
      }
    }

    const transport = /(\/mcp)$/i.test(serverUrl) ? 'http' : /(\/sse)$/i.test(serverUrl) ? 'sse' : 'http';
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
      } catch {
        /* ignore */
      }
    }

    return [];
  }

  private async fetchRequiredHeadersUsing(client: Client, serverUrl: string): Promise<TesterHeaderRequirement[]> {
    // 1) Try HTTP endpoint /used-http-headers
    try {
      const baseURL = serverUrl.replace(/\/(mcp|sse)$/, '');
      const headersUrl = baseURL + '/used-http-headers';
      logger.info('Fetching used-header requirements');
      const response = await fetch(headersUrl, { method: 'GET', headers: { Accept: 'application/json' } });
      if (response.ok) {
        const headers = await response.json();
        if (Array.isArray(headers)) {
          if (headers.length > 0) {
            logger.info(`Found ${headers.length} used-header requirements`);
          }
          return headers;
        }
      }
    } catch (e) {
      logInternalError(e, 'agent_tester_headers_endpoint');
    }

    // 2) Fallback: MCP resource use://http-headers
    try {
      const resource: any = await (client as any).readResource({ uri: 'use://http-headers' });
      const contents: any[] = Array.isArray(resource?.contents)
        ? resource.contents
        : Array.isArray(resource)
          ? resource
          : [];

      let parsed: any = undefined;
      for (const c of contents) {
        const mime = (c?.mimeType || c?.mime_type || '').toLowerCase();
        const text = c?.text ?? c?.value ?? c?.data ?? undefined;
        if (mime === 'application/json' && typeof text === 'string') {
          try {
            parsed = JSON.parse(text);
          } catch {
            /* ignore */
          }
        } else if (typeof c === 'string') {
          try {
            parsed = JSON.parse(c);
          } catch {
            /* ignore */
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
        } catch {
          /* ignore */
        }
      }

      const headerRequirements: TesterHeaderRequirement[] = Array.isArray(parsed) ? parsed : [];
      if (headerRequirements.length > 0) {
        logger.info(`Found ${headerRequirements.length} used headers via MCP resource use://http-headers`);
        return headerRequirements;
      }
    } catch (e: Error | any) {
      logInternalError(e, 'agent_tester_headers_resource');
    }

    return [];
  }

  public async connectToServer(request: TesterMcpConnectionRequest): Promise<TesterMcpConnectionResponse> {
    try {
      logger.info(`Attempting MCP connection via transport=${request.transport}`);

      let client: Client;
      try {
        client = await this.createMcpClient(request);

        const toolsList = await client.listTools();
        const tools: ITesterMcpTool[] = toolsList.tools.map((tool) => {
          const t: ITesterMcpTool = {
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema,
          };
          const meta = (tool as any)._meta;
          if (meta && typeof meta === 'object') {
            t._meta = meta;
          }
          return t;
        });

        let agentPrompt: string | undefined;
        try {
          const prompts = await client.listPrompts();
          const agentPromptInfo = prompts.prompts.find((p) => p.name === 'agent_prompt');
          if (agentPromptInfo) {
            try {
              const promptData = await client.getPrompt({ name: 'agent_prompt' });
              const validMessages = promptData.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
              agentPrompt = validMessages.map((m: any) => m.content.text).join('\n');
            } catch (promptDataError) {
              logInternalError(promptDataError, 'agent_tester_prompt_format');
            }
          }
        } catch (promptError) {
          logInternalError(promptError, 'agent_tester_prompt_unavailable');
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
        if (request.appMode) {
          serverConfig.appMode = true;
        }

        this.clients.set(request.name, client);
        this.servers.set(request.name, serverConfig);

        logger.info('Successfully connected to MCP server', {
          toolCount: tools.length,
          hasAgentPrompt: !!agentPrompt,
          transport: request.transport,
          appMode: !!request.appMode,
        });

        return {
          success: true,
          config: serverConfig,
        };
      } catch (connectionError) {
        logInternalError(connectionError, 'agent_tester_mcp_connection');

        const serverConfig: TesterMcpServerConfig = {
          name: request.name,
          url: request.url,
          transport: request.transport,
          isConnected: false,
          tools: [],
          connectionError: 'Connection failed',
        };
        if (request.headers) {
          serverConfig.headers = request.headers;
        }

        this.servers.set(request.name, serverConfig);

        return {
          success: false,
          error: 'Connection failed',
        };
      }
    } catch (error) {
      const errorMessage = 'Connection failed';
      logInternalError(error, 'agent_tester_mcp_connection');

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

  private async createMcpClient(request: TesterMcpConnectionRequest): Promise<Client> {
    const client = new Client(
      { name: 'agent-tester', version: '1.0.0' },
      this.buildClientCapabilities(request.appMode),
    );

    const baseURL = new URL(request.url);

    if (request.transport === 'http') {
      const safeHeaders = this.buildSafeHeaders(request.headers);
      const transportOpts: any = {};
      if (safeHeaders) {
        transportOpts.requestInit = { headers: safeHeaders };
      }
      const transport = new StreamableHTTPClientTransport(baseURL, transportOpts);
      await client.connect(transport as any);
    } else if (request.transport === 'sse') {
      const safeHeaders = this.buildSafeHeaders(request.headers);
      const transportOpts: any = {};
      if (safeHeaders) {
        transportOpts.eventSourceInit = { headers: safeHeaders };
        transportOpts.requestInit = { headers: safeHeaders };
      }
      const transport = new SSEClientTransport(baseURL, transportOpts);
      await client.connect(transport as any);
    } else {
      throw new Error(`Unsupported transport: ${request.transport}`);
    }

    return client;
  }

  public async disconnectFromServer(serverName: string): Promise<void> {
    logger.info('Disconnecting from MCP server');

    const client = this.clients.get(serverName);
    if (client) {
      try {
        await client.close();
        logger.info('Closed MCP connection');
      } catch (error) {
        logInternalError(error, 'agent_tester_mcp_disconnect');
      }
      this.clients.delete(serverName);
    }

    const serverConfig = this.servers.get(serverName);
    if (serverConfig) {
      serverConfig.isConnected = false;
      serverConfig.connectionError = 'Manually disconnected';
    }
  }

  public async updateHeaders(
    serverName: string,
    headers: Record<string, string>,
  ): Promise<TesterMcpConnectionResponse> {
    const config = this.servers.get(serverName);
    if (!config) {
      return { success: false, error: 'Server not found' };
    }

    config.headers = { ...headers };

    try {
      try {
        await this.disconnectFromServer(serverName);
      } catch {}

      const response = await this.connectToServer({
        name: config.name,
        url: config.url,
        transport: config.transport as 'http' | 'sse',
        headers: config.headers,
        ...(config.appMode ? { appMode: true } : {}),
      });

      return response;
    } catch (e) {
      logInternalError(e, 'agent_tester_header_update');
      return { success: false, error: 'Failed to update headers' };
    }
  }

  public getAllServerConfigs(): TesterMcpServerConfig[] {
    return Array.from(this.servers.values());
  }

  public async cleanup(): Promise<void> {
    logger.info('Cleaning up MCP connections');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const entry of this.clientCache.values()) {
      try {
        await entry.client.close?.();
        logger.info('Closed cached MCP client');
      } catch (error) {
        logInternalError(error, 'agent_tester_cached_client_close');
      }
    }
    this.clientCache.clear();

    for (const client of this.clients.values()) {
      try {
        await client.close();
        logger.info('Closed MCP connection');
      } catch (error) {
        logInternalError(error, 'agent_tester_mcp_disconnect');
      }
    }

    this.clients.clear();
    this.servers.clear();
  }
}
