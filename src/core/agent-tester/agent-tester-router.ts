import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import chalk from 'chalk';
import { Router } from 'express';
import express from 'express';

import { generateToken } from '../auth/jwt.js';
import {
  COOKIE_NAME,
  createSession,
  deleteSession,
  getAvailableAuthMethods,
  getSessionTtlMs,
  hasValidSession,
  validateLoginCredentials,
} from '../auth/agent-tester-auth.js';
import { appConfig } from '../bootstrap/init-config.js';
import { logger as lgr } from '../logger.js';

import { TesterAgentService } from './services/TesterAgentService.js';
import { TesterMcpClientService } from './services/TesterMcpClientService.js';
import {
  findEmbeddedAppResource,
  getToolUiResourceUri,
  readUiResource,
} from './services/mcp-apps-utils.js';
import { ITesterChatRequest, TesterMcpConfig, TesterMcpConnectionRequest, ITesterMcpTool } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = lgr.getSubLogger({ name: chalk.cyan('agent-tester') });

export function createAgentTesterRouter(
  options: {
    defaultMcpUrl?: string;
    openAi?: { apiKey?: string; baseURL?: string };
  } = {},
): Router {
  const router = Router();

  const mcpClientService = new TesterMcpClientService();
  const agentService = new TesterAgentService(mcpClientService, options.openAi, appConfig.agentTester?.logJson);

  // Serve static files (index.html, script.js, styles.css)
  const staticPath = join(__dirname, '..', 'web', 'static', 'agent-tester');
  router.use('/static', express.static(staticPath));

  // Serve tester UI
  router.get('/', (req, res) => {
    res.sendFile(join(staticPath, 'index.html'));
  });

  // ===== Auth API (session-based) =====

  // GET /api/auth/status — frontend checks whether login is required
  router.get('/api/auth/status', (req, res) => {
    const useAuth = !!appConfig.agentTester?.useAuth;
    if (!useAuth) {
      res.json({ authRequired: false });
      return;
    }

    res.json({
      authRequired: true,
      authenticated: hasValidSession(req),
      methods: getAvailableAuthMethods(),
    });
  });

  // POST /api/auth/login — validate credentials, create session, set cookie
  router.post('/api/auth/login', (req, res): void => {
    const authResult = validateLoginCredentials(req.body || {});
    if (!authResult.success) {
      res.status(401).json({ error: authResult.error || 'Authentication failed' });
      return;
    }

    const sid = createSession(authResult);

    res.cookie(COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/agent-tester',
      maxAge: getSessionTtlMs(),
    });

    res.json({ success: true, authType: authResult.authType });
  });

  // POST /api/auth/logout — destroy session, clear cookie
  router.post('/api/auth/logout', (req, res) => {
    deleteSession(req);
    res.clearCookie(COOKIE_NAME, { path: '/agent-tester' });
    res.json({ success: true });
  });

  // ===== Config API =====

  // API: Get default config (port, MCP URL)
  router.get('/api/config', (req, res) => {
    const openAi = appConfig.agentTester?.openAi;
    const expose = !!openAi?.exposeToClient;
    res.json({
      defaultMcpUrl: options.defaultMcpUrl || null,
      authEnabled: !!appConfig.webServer?.auth?.enabled,
      httpHeaders: appConfig.agentTester?.httpHeaders || {},
      sdkVersion: appConfig.sdkVersion || '',
      llmDefaults: {
        baseURL: expose ? openAi?.baseURL || '' : '',
        apiKey: expose ? openAi?.apiKey || '' : '',
      },
    });
  });

  // API: Get auth token for auto-fill (MCP server Authorization header)
  router.get('/api/auth-token', (req, res): void => {
    const auth = appConfig.webServer?.auth;
    if (!auth?.enabled) {
      res.status(404).json({ error: 'Auth is not enabled' });
      return;
    }

    const ttlSec = appConfig.agentTester?.tokenTTLSec ?? 1800;

    // Agent Tester priority: jwtToken → basic → permanentServerTokens
    if (auth.jwtToken?.encryptKey) {
      const jwt = generateToken('agentTester', ttlSec, { service: appConfig.name });
      res.json({ authType: 'jwtToken', token: `Bearer ${jwt}`, ttlSec });
      return;
    }

    if (auth.basic?.username && auth.basic?.password) {
      const encoded = Buffer.from(`${auth.basic.username}:${auth.basic.password}`).toString('base64');
      res.json({ authType: 'basic', token: `Basic ${encoded}` });
      return;
    }

    if (auth.permanentServerTokens?.length) {
      res.json({ authType: 'permanentServerTokens', token: `Bearer ${auth.permanentServerTokens[0]}` });
      return;
    }

    res.status(404).json({ error: 'No auth method configured' });
  });

  // API: Refresh JWT auth token
  router.post('/api/auth-token/refresh', (req, res): void => {
    const auth = appConfig.webServer?.auth;
    if (!auth?.enabled || !auth.jwtToken?.encryptKey) {
      res.status(400).json({ error: 'JWT auth is not configured' });
      return;
    }

    const ttlSec = appConfig.agentTester?.tokenTTLSec ?? 1800;
    const jwt = generateToken('agentTester', ttlSec, { service: appConfig.name });
    res.json({ authType: 'jwtToken', token: `Bearer ${jwt}`, ttlSec });
  });

  // ===== Chat API =====

  // POST /api/chat/message
  router.post('/api/chat/message', async (req, res): Promise<void> => {
    try {
      const chatRequest: ITesterChatRequest = req.body;
      if (!chatRequest.message?.trim()) {
        res.status(400).json({ error: 'Message is required' });
        return;
      }
      const response = await agentService.processMessage(chatRequest);
      res.json(response);
    } catch (error: any) {
      logger.error('Chat message error:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // POST /api/chat/test — headless test endpoint with trace data
  router.post('/api/chat/test', async (req, res): Promise<void> => {
    try {
      const chatRequest: ITesterChatRequest = req.body;
      if (!chatRequest.message?.trim()) {
        res.status(400).json({ error: 'Message is required' });
        return;
      }
      const verbose = req.query.verbose === 'true';
      const maxTraceChars = parseInt(req.query.maxTraceChars as string) || 50000;
      const maxResultChars = parseInt(req.query.maxResultChars as string) || 4000;
      const response = await agentService.processMessageWithTrace(chatRequest, {
        verbose,
        maxTraceChars,
        maxResultChars,
      });
      res.json(response);
    } catch (error: any) {
      logger.error('Chat test error:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // GET /api/chat/sessions
  router.get('/api/chat/sessions', (req, res) => {
    res.json(agentService.getAllSessions());
  });

  // GET /api/chat/sessions/:sessionId
  router.get('/api/chat/sessions/:sessionId', (req, res): void => {
    const session = agentService.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  });

  // DELETE /api/chat/sessions/:sessionId
  router.delete('/api/chat/sessions/:sessionId', (req, res): void => {
    const deleted = agentService.deleteSession(req.params.sessionId);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ message: 'Session deleted successfully' });
  });

  // ===== MCP API =====

  // GET /api/mcp/status — connection state and available tools
  router.get('/api/mcp/status', (req, res) => {
    const servers = mcpClientService.getAllServerConfigs();
    const connected = servers.filter((s) => s.isConnected);
    res.json({
      connected: connected.length > 0,
      servers: connected.map((s) => ({
        name: s.name,
        url: s.url,
        transport: s.transport,
        appMode: !!s.appMode,
        tools: (s.tools || []).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t._meta ? { _meta: t._meta } : {}),
        })),
        toolCount: s.tools?.length || 0,
      })),
      totalTools: connected.reduce((sum, s) => sum + (s.tools?.length || 0), 0),
    });
  });

  // POST /api/mcp/connect
  router.post('/api/mcp/connect', async (req, res): Promise<void> => {
    try {
      const connectionRequest: TesterMcpConnectionRequest = req.body;
      if (!connectionRequest.url || !connectionRequest.transport) {
        res.status(400).json({ error: 'URL and transport type are required' });
        return;
      }
      if (!connectionRequest.name) {
        connectionRequest.name = generateServerName(connectionRequest.url);
      }
      const result = await mcpClientService.connectToServer(connectionRequest);
      res.json(result);
    } catch (error: any) {
      logger.error('MCP connect error:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // POST /api/mcp/disconnect/:serverName
  router.post('/api/mcp/disconnect/:serverName', async (req, res) => {
    try {
      await mcpClientService.disconnectFromServer(req.params.serverName);
      res.json({ message: `Disconnected from ${req.params.serverName}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/mcp/headers
  router.post('/api/mcp/headers', async (req, res): Promise<void> => {
    try {
      const { serverName, headers } = req.body || {};
      if (!serverName || typeof headers !== 'object') {
        res.status(400).json({ error: 'serverName and headers are required' });
        return;
      }
      const result = await mcpClientService.updateHeaders(serverName, headers);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/mcp/servers
  router.get('/api/mcp/servers', (req, res) => {
    res.json(mcpClientService.getAllServerConfigs());
  });

  // POST /api/mcp/call-tool — direct MCP tool invocation (no LLM involved)
  router.post('/api/mcp/call-tool', async (req, res): Promise<void> => {
    try {
      const { serverName, toolName, parameters } = req.body || {};
      if (!serverName || !toolName) {
        res.status(400).json({ error: 'serverName and toolName are required' });
        return;
      }
      const server = mcpClientService.getAllServerConfigs().find((s) => s.name === serverName);
      if (!server || !server.isConnected) {
        res.status(404).json({ error: `Server ${serverName} is not connected` });
        return;
      }
      const mcpConfig: TesterMcpConfig = {
        url: server.url,
        transport: server.transport as 'http' | 'sse',
        name: server.name,
      };
      if (server.headers) {
        mcpConfig.headers = server.headers;
      }
      if (server.appMode) {
        mcpConfig.appMode = true;
      }
      const startedAt = Date.now();
      const result = await mcpClientService.callToolWithConfig(mcpConfig, toolName, parameters || {});

      // When the connected session advertised MCP Apps support, also surface
      // the UI resource (embedded in result OR fetched via the tool's
      // `_meta.ui.resourceUri`) so the Tool Tester split-view can render the
      // widget without a second roundtrip from the frontend.
      let uiResource;
      if (server.appMode) {
        uiResource = findEmbeddedAppResource(result);
        if (!uiResource) {
          const tool: ITesterMcpTool | undefined = (server.tools || []).find((t) => t.name === toolName);
          const uri = getToolUiResourceUri(tool);
          if (uri) {
            try {
              const cached = await mcpClientService.getOrCreateClient(mcpConfig);
              uiResource = await readUiResource(cached.client, uri);
            } catch (e) {
              logger.warn(`Failed to read UI resource ${uri} for tool ${toolName}:`, e);
            }
          }
        }
      }

      const response: Record<string, unknown> = { success: true, result, durationMs: Date.now() - startedAt };
      if (uiResource) {
        response.uiResource = uiResource;
      }
      res.json(response);
    } catch (error: any) {
      logger.error('MCP call-tool error:', error);
      res.status(500).json({ success: false, error: error.message || 'Tool execution failed' });
    }
  });

  // GET /api/mcp/ui-resources — list UI-flavored resources for the App Inspector
  router.get('/api/mcp/ui-resources', async (req, res): Promise<void> => {
    try {
      const serverName = req.query.serverName as string;
      if (!serverName) {
        res.status(400).json({ error: 'serverName is required' });
        return;
      }
      const server = mcpClientService.getAllServerConfigs().find((s) => s.name === serverName);
      if (!server || !server.isConnected) {
        res.status(404).json({ error: `Server ${serverName} is not connected` });
        return;
      }
      const mcpConfig: TesterMcpConfig = {
        url: server.url,
        transport: server.transport as 'http' | 'sse',
        name: server.name,
      };
      if (server.headers) {
        mcpConfig.headers = server.headers;
      }
      if (server.appMode) {
        mcpConfig.appMode = true;
      }
      const cached = await mcpClientService.getOrCreateClient(mcpConfig);
      try {
        const list = await (cached.client as any).listResources();
        const all = Array.isArray(list?.resources) ? list.resources : [];
        const uiOnly = all.filter((r: any) => {
          const m = r?.mimeType || r?.mime_type;
          return m === 'text/html;profile=mcp-app' || (typeof r?.uri === 'string' && r.uri.startsWith('ui://'));
        });
        res.json({ resources: uiOnly });
      } catch (e: any) {
        res.status(500).json({ error: e.message || 'listResources failed' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/mcp/used-headers
  router.get('/api/mcp/used-headers', async (req, res): Promise<void> => {
    try {
      const url = req.query.url as string;
      if (!url) {
        res.status(400).json({ error: 'URL parameter is required' });
        return;
      }
      const headers = await mcpClientService.getRequiredHeaders(url);
      res.json(headers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  logger.info('Agent Tester router initialized');
  return router;
}

function generateServerName(url: string): string {
  try {
    const urlObj = new URL(url);
    let { hostname } = urlObj;
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    const firstSegment = hostname.split('.')[0] || hostname;
    const { port } = urlObj;
    return port ? `${firstSegment}${port}` : firstSegment;
  } catch {
    return `server_${Date.now()}`;
  }
}
