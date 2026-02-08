export interface ITesterChatMessage {
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

export interface ITesterChatSession {
  id: string;
  messages: ITesterChatMessage[];
  agentPrompt?: string;
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

export interface ITesterChatRequest {
  message: string;
  sessionId?: string;
  agentPrompt?: string;
  customPrompt?: string;
  mcpConfig?: TesterMcpConfig;
  modelConfig?: TesterModelConfig;
  model?: string;
  mcpServerUrl?: string;
}

export interface ITesterChatResponse {
  id: string;
  message: string;
  sessionId: string;
  metadata: {
    response_time: number;
    tools_used: string[];
    mcp_server?: string;
  };
}

export interface ITesterMcpTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface ITesterCachedMcpClient {
  client: any;
  config: TesterMcpConfig;
  tools: ITesterMcpTool[];
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
  tools?: ITesterMcpTool[];
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

// ===== Trace types for headless test API =====

export interface ITesterTraceTurn {
  turn: number;
  llm_request?: {
    model: string;
    messages_count: number;
  };
  llm_response?: {
    finish_reason: string | null;
    content: string | null;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
  tool_calls: { name: string; arguments: Record<string, unknown> }[];
  tool_results: { name: string; result: unknown; duration_ms?: number }[];
}

export interface ITesterTraceData {
  system_prompt_sent?: string;
  turns: ITesterTraceTurn[];
  total_turns: number;
  total_duration_ms: number;
  tools_used: string[];
}

export interface ITesterTestResponse {
  message: string;
  sessionId: string;
  trace: ITesterTraceData;
}

export interface ITesterTestOptions {
  verbose?: boolean;
  maxTraceChars?: number;
  maxResultChars?: number;
}
