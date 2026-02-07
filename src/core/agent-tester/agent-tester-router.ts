import { Router } from 'express';
import chalk from 'chalk';
import { logger as lgr } from '../logger.js';
import { TesterAgentService } from './services/TesterAgentService.js';
import { TesterMcpClientService } from './services/TesterMcpClientService.js';
import { TesterChatRequest, TesterMcpConnectionRequest } from './types.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { appConfig } from '../bootstrap/init-config.js';
import { generateToken } from '../auth/jwt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = lgr.getSubLogger({ name: chalk.cyan('agent-tester') });

export function createAgentTesterRouter (options: {
  defaultMcpUrl?: string;
  openAi?: { apiKey?: string; baseUrl?: string };
} = {}): Router {
  const router = Router();

  const mcpClientService = new TesterMcpClientService();
  const agentService = new TesterAgentService(mcpClientService, options.openAi);

  // Serve static files (index.html, script.js, styles.css)
  const staticPath = join(__dirname, '..', 'web', 'static', 'agent-tester');
  router.use('/static', express.static(staticPath));

  // Serve tester UI
  router.get('/', (req, res) => {
    res.sendFile(join(staticPath, 'index.html'));
  });

  // API: Get default config (port, MCP URL)
  router.get('/api/config', (req, res) => {
    res.json({
      defaultMcpUrl: options.defaultMcpUrl || null,
      authEnabled: !!appConfig.webServer?.auth?.enabled,
      httpHeaders: appConfig.agentTester?.httpHeaders || {},
    });
  });

  // API: Get auth token for auto-fill
  router.get('/api/auth-token', (req, res): void => {
    const auth = appConfig.webServer?.auth;
    if (!auth?.enabled) {
      res.status(404).json({ error: 'Auth is not enabled' });
      return;
    }

    // Priority matches authOrder: permanentServerTokens → basic → jwtToken
    if (auth.permanentServerTokens?.length) {
      res.json({ authType: 'permanentServerTokens', token: `Bearer ${auth.permanentServerTokens[0]}` });
      return;
    }

    if (auth.basic?.username && auth.basic?.password) {
      const encoded = Buffer.from(`${auth.basic.username}:${auth.basic.password}`).toString('base64');
      res.json({ authType: 'basic', token: `Basic ${encoded}` });
      return;
    }

    if (auth.jwtToken?.encryptKey) {
      const jwt = generateToken('agentTester', 300, { service: appConfig.name });
      res.json({ authType: 'jwtToken', token: `Bearer ${jwt}` });
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

    const jwt = generateToken('agentTester', 300, { service: appConfig.name });
    res.json({ authType: 'jwtToken', token: `Bearer ${jwt}` });
  });

  // ===== Chat API =====

  // POST /api/chat/message
  router.post('/api/chat/message', async (req, res): Promise<void> => {
    try {
      const chatRequest: TesterChatRequest = req.body;
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

  // GET /api/mcp/required-headers
  router.get('/api/mcp/required-headers', async (req, res): Promise<void> => {
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

function generateServerName (url: string): string {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;
    if (hostname.startsWith('www.')) {hostname = hostname.substring(4);}
    const firstSegment = hostname.split('.')[0] || hostname;
    const port = urlObj.port;
    return port ? `${firstSegment}${port}` : firstSegment;
  } catch {
    return `server_${Date.now()}`;
  }
}
