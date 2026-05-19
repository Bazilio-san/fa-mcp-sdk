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
  /**
   * When true, the underlying MCP `Client` is created with
   * `capabilities.extensions["io.modelcontextprotocol/ui"]` so the server can
   * branch between text-only and UI-augmented tool variants. Cache key includes
   * this flag, so toggling it forces a fresh client.
   */
  appMode?: boolean;
}

export interface TesterModelConfig {
  baseURL?: string;
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
  /**
   * Mirror of `mcpConfig.appMode` available at the request level for the
   * headless `/api/chat/test` API where callers may omit `mcpConfig` and let
   * the server build it from defaults.
   */
  appMode?: boolean;
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
  /**
   * Populated when the request ran in app-mode. Each entry mirrors a tool
   * invocation with its full result plus (when available) the UI resource the
   * host should render. Order matches tool-call order in the LLM turns.
   */
  appCalls?: IMcpAppCall[];
}

export interface ITesterMcpTool {
  name: string;
  description: string;
  inputSchema: any;
  /**
   * Server-supplied tool metadata. We preserve the raw map so callers can read
   * `_meta.ui.resourceUri` (MCP Apps) and other extensions without parsing
   * server responses themselves.
   */
  _meta?: Record<string, any>;
}

/**
 * Single tool invocation paired with the (optional) MCP App UI resource that
 * the host would render. Returned alongside chat responses when `appMode=true`.
 */
export interface IMcpAppCall {
  /** OpenAI `tool_call_id` — stable correlator between the LLM message, the tool result, and the rendered widget. */
  callId: string;
  toolName: string;
  /** Arguments the model passed to the tool — forwarded to the View via `ui/notifications/tool-input`. */
  arguments?: Record<string, unknown>;
  /** Full, untruncated `CallToolResult` from the MCP server. */
  result: any;
  /**
   * UI resource the host would render. Absent when the tool has no
   * `_meta.ui.resourceUri` and the result does not embed an `mcp-app` resource.
   */
  uiResource?: IMcpAppUiResource;
}

/**
 * UI resource payload extracted from either a tool's `_meta.ui.resourceUri`
 * (via `resources/read`) or an embedded resource in the tool result.
 */
export interface IMcpAppUiResource {
  uri: string;
  mimeType: string;
  /** Inline HTML. Servers MAY also use `blob` (base64) — we surface `text` only for the MVP. */
  text: string;
  /** `_meta.ui` from the resource content (CSP, permissions, prefersBorder, ...). */
  meta?: Record<string, any>;
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
  /** Whether the active session advertised MCP Apps UI capability. */
  appMode?: boolean;
}

export interface TesterMcpConnectionRequest {
  name: string;
  url: string;
  transport: 'http' | 'sse';
  headers?: Record<string, string>;
  /** Advertise MCP Apps UI capability during `initialize`. */
  appMode?: boolean;
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
  /**
   * Present when the request ran in app-mode. Captures which UI resources the
   * server would have delivered to a real host. Headless never renders — this
   * is purely a trace for automated assertions.
   */
  app_calls?: IMcpAppCall[];
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
