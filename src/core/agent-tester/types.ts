export interface TesterChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
  metadata?: {
    tools_used?: string[];
    mcp_server?: string;
    response_time?: number;
  };
}

export interface TesterChatSession {
  id: string;
  messages: TesterChatMessage[];
  systemPrompt?: string;
  mcpServerUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TesterMcpConfig {
  url: string;
  transport: 'http' | 'sse';
  headers?: Record<string, string>;
  name?: string;
}

export interface TesterModelConfig {
  baseUrl?: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;
  toolResultLimitChars?: number;
}

export interface TesterChatRequest {
  message: string;
  sessionId?: string;
  systemPrompt?: string;
  customPrompt?: string;
  mcpConfig?: TesterMcpConfig;
  modelConfig?: TesterModelConfig;
  model?: string;
  mcpServerUrl?: string;
}

export interface TesterChatResponse {
  id: string;
  message: string;
  sessionId: string;
  metadata: {
    response_time: number;
    tools_used: string[];
    mcp_server?: string;
  };
}

export interface TesterMcpTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface TesterCachedMcpClient {
  client: any;
  config: TesterMcpConfig;
  tools: TesterMcpTool[];
  agentPrompt?: string;
  lastUsed: Date;
  connectionKey: string;
}

export interface TesterHeaderRequirement {
  name: string;
  description: string;
}

export interface TesterMcpServerConfig {
  name: string;
  url: string;
  transport: 'http' | 'sse' | 'stdio';
  isConnected: boolean;
  tools?: TesterMcpTool[];
  agentPrompt?: string;
  lastConnected?: Date;
  connectionError?: string;
  headers?: Record<string, string>;
}

export interface TesterMcpConnectionRequest {
  name: string;
  url: string;
  transport: 'http' | 'sse';
  headers?: Record<string, string>;
}

export interface TesterMcpConnectionResponse {
  success: boolean;
  config?: TesterMcpServerConfig;
  error?: string;
}
