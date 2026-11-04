import chalk from 'chalk';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

import { appConfig } from '../../bootstrap/init-config.js';
import { logger as lgr } from '../../logger.js';
import {
  ITesterChatSession,
  ITesterMcpTool,
  ITesterChatRequest,
  ITesterChatResponse,
  ITesterCachedMcpClient,
  ITesterTestResponse,
  ITesterTestOptions,
  ITesterTraceData,
  ITesterTraceTurn,
  TesterMcpConfig,
  IMcpAppCall,
} from '../types.js';

import { findEmbeddedAppResource, getToolUiResourceUri, readUiResource } from './mcp-apps-utils.js';

import { createResponse } from './ResponsesClient.js';
import { SummaryMemory, SummaryState } from './SummaryMemory.js';
import { TesterMcpClientService } from './TesterMcpClientService.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('agent-tester:agent') });

const REASONING_EFFORT_MIN: Record<string, string> = {
  'gpt-6-luna': 'none',
  'gpt-6.1-terra': 'none',
  'gpt-6.1-sol': 'low',
};

// Keys also match model snapshots with a hyphenated suffix.
// Longest match wins so a broader key never shadows a narrower one.
function minReasoningEffortFor(model: string): string | undefined {
  const key = Object.keys(REASONING_EFFORT_MIN)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? REASONING_EFFORT_MIN[key] : undefined;
}

interface AgentConfig {
  model: string;
  agentPrompt: string;
  temperature: number;
  maxTokens: number;
  maxTurns: number;
  toolResultLimitChars: number;
  tools: ITesterMcpTool[];
  mcpServerUrl?: string;
}

export class TesterAgentService {
  private sessions: Map<string, ITesterChatSession> = new Map();
  private defaultConfig: AgentConfig;
  private openai: OpenAI | null = null;

  private historyRoutes = new Map<string, string>();

  private summaryMemory = new SummaryMemory({
    tailSize: 6,
    maxTokens: 8000,
    maxToolPayloadChars: 5000,
  });

  private logJson: boolean;

  constructor(
    private mcpClientService: TesterMcpClientService,
    private openAiConfig?: { apiKey?: string; baseURL?: string },
    logJson?: boolean,
  ) {
    this.logJson = logJson || false;
    this.defaultConfig = {
      // Headless default model — driven by config (headlessTester.defaultModel); used when the request omits modelConfig.model.
      model: appConfig.headlessTester?.defaultModel || 'gpt-6-luna',
      agentPrompt: 'You are a helpful AI assistant that can use MCP tools to help users.',
      temperature: 0.3,
      maxTokens: 4096,
      maxTurns: 10,
      toolResultLimitChars: 40000,
      tools: [],
    };

    if (openAiConfig?.apiKey) {
      this.openai = new OpenAI({
        apiKey: openAiConfig.apiKey,
        ...(openAiConfig.baseURL ? { baseURL: openAiConfig.baseURL } : {}),
      });
    }
  }

  public async cleanup(): Promise<void> {
    logger.info('Cleaning up TesterAgentService');
    this.sessions.clear();
    this.historyRoutes.clear();
    this.summaryMemory.clear();
  }

  private createModelResponse(llmClient: OpenAI, params: any, api?: 'responses' | 'chat-completions') {
    return createResponse(llmClient, params, api);
  }

  /**
   * Returns the system-prompt addendum sent to the LLM when the user toggled
   * MCP Apps mode in the UI. The block names the tools that ship a UI
   * resource so the model can prefer them when visualization helps.
   */
  private buildAppModeSystemPrompt(tools: ITesterMcpTool[]): string {
    const appTools = tools.filter((t) => {
      const uri = t._meta?.ui?.resourceUri ?? t._meta?.['ui/resourceUri'];
      return typeof uri === 'string' && uri.length > 0;
    });

    const lines = [
      'The user is interacting through an MCP Apps host that renders tool UI resources as interactive widgets.',
      'Tools whose definition carries `_meta.ui.resourceUri` produce a widget the user can see — prefer them when visualization (maps, tables, forms, charts) is more useful than prose.',
      'Do not describe the widget in text; the user already sees it. Summarize only what the widget does NOT show.',
    ];
    if (appTools.length > 0) {
      lines.push('Tools with UI widgets in this session: ' + appTools.map((t) => t.name).join(', '));
    }
    return lines.join('\n');
  }

  /**
   * Extract MCP Apps UI resource for a tool invocation. Two delivery paths are
   * supported per the spec: (a) tool definition exposes `_meta.ui.resourceUri`
   * — the host reads the resource separately, (b) the tool result embeds an
   * `mcp-app` resource directly in `content[]`. Returns an `IMcpAppCall` for
   * every invocation (even without UI) so the host can inspect raw results.
   */
  private async extractAppCall(
    tool: ITesterMcpTool | undefined,
    callId: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    result: unknown,
    mcpConfig: TesterMcpConfig,
  ): Promise<IMcpAppCall> {
    const call: IMcpAppCall = { callId, toolName, result };
    if (args && Object.keys(args).length > 0) {
      call.arguments = args;
    }

    const embedded = findEmbeddedAppResource(result);
    if (embedded) {
      call.uiResource = embedded;
      return call;
    }

    const resourceUri = getToolUiResourceUri(tool);
    if (resourceUri) {
      try {
        const cached = await this.mcpClientService.getOrCreateClient(mcpConfig);
        const ui = await readUiResource(cached.client, resourceUri);
        if (ui) {
          call.uiResource = ui;
        }
      } catch (e) {
        logger.warn(`Failed to read UI resource ${resourceUri} for tool ${toolName}:`, e);
      }
    }

    return call;
  }

  private buildSummaryPrompt(): string {
    return `You are a dialog history compression module. Compress the history into a brief "memory" without losing meaning.

Requirements:
- Preserve user goals, constraints, decisions made.
- Preserve important tool results (as facts).
- Remove repetitions, details, long texts, noise.
- Use strictly structured format:

Summary Memory:
- User goals: ...
- Constraints: ...
- Tools used:
  - <tool>: <key results>
- Decisions: ...
- Open issues: ...

Input:
1) Old summary (if any)
2) New messages (JSON)

First consider the old summary, then merge with new messages.
Output only the new Summary Memory.`;
  }

  private async summarizeHistory(
    llmClient: OpenAI,
    state: SummaryState,
    model: string,
    api?: 'responses' | 'chat-completions',
  ): Promise<void> {
    const summaryPrompt = this.buildSummaryPrompt();
    const payload = JSON.stringify(state.tail.slice(0, state.compressionCount));

    const summaryParams: any = {
      model,
      messages: [
        { role: 'system', content: summaryPrompt },
        { role: 'user', content: `OLD SUMMARY:\n${state.summary || '(empty)'}\n\nNEW MESSAGES(JSON):\n${payload}` },
      ],
      max_completion_tokens: 1000,
    };
    const minEffort = api === 'chat-completions' ? minReasoningEffortFor(model) : undefined;
    if (minEffort) {
      summaryParams.reasoning_effort = minEffort;
    }

    const response = await this.createModelResponse(llmClient, summaryParams, api);

    state.summary = response.choices[0]?.message?.content?.trim() || state.summary;
    this.summaryMemory.resetAfterCompression(state);
  }

  public async processMessage(request: ITesterChatRequest): Promise<ITesterChatResponse> {
    const result = await this.processMessageWithTrace(request);
    const session = this.sessions.get(result.sessionId)!;
    const message = session.messages[session.messages.length - 1]!;
    return {
      id: message.id,
      message: result.message,
      sessionId: result.sessionId,
      metadata: { response_time: result.trace.total_duration_ms, tools_used: result.trace.tools_used },
      ...(request.mcpConfig?.url || request.mcpServerUrl
        ? {
            metadata: {
              response_time: result.trace.total_duration_ms,
              tools_used: result.trace.tools_used,
              mcp_server: (request.mcpConfig?.url || request.mcpServerUrl)!,
            },
          }
        : {}),
      ...(result.appCalls ? { appCalls: result.appCalls } : {}),
    };
  }

  public async processMessageWithTrace(
    request: ITesterChatRequest,
    options: ITesterTestOptions = {},
  ): Promise<ITesterTestResponse> {
    const { verbose = false, maxTraceChars = 50000, maxResultChars = 4000 } = options;
    const startTime = Date.now();
    const sessionId = request.sessionId || uuidv4();
    let historyBefore: SummaryState | undefined;

    try {
      const { mcpConfig } = request;
      const mcpServerUrl = mcpConfig?.url || request.mcpServerUrl;
      const appCalls: IMcpAppCall[] = [];
      const appMode = !!(request.appMode || mcpConfig?.appMode);
      if (appMode && mcpConfig && !mcpConfig.appMode) {
        mcpConfig.appMode = true;
      }

      // Get or create session
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = this.createSession(sessionId, request.agentPrompt, mcpServerUrl);
        this.sessions.set(sessionId, session);
      }

      // Add user message to session
      session.messages.push({
        id: uuidv4(),
        text: request.message,
        sender: 'user',
        timestamp: new Date(),
      });

      // Get tools and agentPrompt from cached client
      let cachedClient: ITesterCachedMcpClient | null = null;
      let agentTools: ITesterMcpTool[] = [];

      if (mcpConfig) {
        try {
          cachedClient = await this.mcpClientService.getOrCreateClient(mcpConfig);
          agentTools = cachedClient.tools;
        } catch (error) {
          logger.error('Failed to get MCP client:', error);
        }
      }

      // Prepare system prompt: request > session > MCP server > default
      const { agentPrompt: mcpAgentPrompt } = cachedClient || {};
      let systemPrompt = request.agentPrompt || session.agentPrompt || mcpAgentPrompt || this.defaultConfig.agentPrompt;

      if (request.customPrompt?.trim()) {
        systemPrompt = `${systemPrompt}\n\n${request.customPrompt.trim()}`;
      }
      if (appMode) {
        systemPrompt = `${systemPrompt}\n\n${this.buildAppModeSystemPrompt(agentTools)}`;
      }
      const systemPromptSent = systemPrompt;

      // Get model configuration
      const { modelConfig } = request;
      const selectedModel = modelConfig?.model || request.model || this.defaultConfig.model;
      const maxTokens = modelConfig?.maxTokens ?? this.defaultConfig.maxTokens;

      // Create OpenAI client — baseURL optional (empty = OpenAI default)
      let llmClient: OpenAI;
      if (modelConfig?.apiKey) {
        llmClient = new OpenAI({
          apiKey: modelConfig.apiKey,
          ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {}),
        });
      } else if (this.openai) {
        llmClient = this.openai;
      } else {
        throw new Error('Agent Tester OpenAI API key is not configured (agentTester.openAi.apiKey)');
      }

      // Create OpenAI function definitions from MCP tools
      const functions = agentTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      }));

      const route = createHash('sha256')
        .update(
          JSON.stringify([
            selectedModel,
            modelConfig?.baseURL || this.openAiConfig?.baseURL,
            modelConfig?.apiKey || this.openAiConfig?.apiKey,
            modelConfig?.api || 'responses',
          ]),
        )
        .digest('hex');
      if (this.historyRoutes.get(sessionId) !== route) {
        this.summaryMemory.delete(sessionId);
      }
      this.historyRoutes.set(sessionId, route);
      // Summary state
      const summaryState = this.summaryMemory.getState(sessionId);
      historyBefore = { ...summaryState, tail: [...summaryState.tail] };
      this.summaryMemory.pushMessage(summaryState, { role: 'user', content: request.message });
      if (this.summaryMemory.needsCompression(summaryState)) {
        await this.summarizeHistory(llmClient, summaryState, selectedModel, modelConfig?.api);
      }
      const summarizedContext = this.summaryMemory.buildMessages(systemPrompt, summaryState);

      const useTemperature = modelConfig?.temperature;
      let finalText = '';
      const toolsUsed: string[] = [];
      const traceturns: ITesterTraceTurn[] = [];

      const toolLimitChars = modelConfig?.toolResultLimitChars ?? this.defaultConfig.toolResultLimitChars ?? 20000;

      const truncateStr = (value: unknown, limit: number): string => {
        let str: string;
        try {
          str = typeof value === 'string' ? value : JSON.stringify(value);
        } catch {
          str = String(value);
        }
        if (str.length <= limit) {
          return str;
        }
        return str.slice(0, limit) + `\n[TRUNCATED: original_length=${str.length}]`;
      };

      const safeJsonParse = (raw: string | undefined): unknown => {
        if (!raw?.trim()) {
          return {};
        }
        try {
          return JSON.parse(raw);
        } catch {
          return { __parse_error: true, raw };
        }
      };

      const maxTurns = modelConfig?.maxTurns ?? this.defaultConfig.maxTurns ?? 10;

      for (let turn = 0; turn < maxTurns; turn++) {
        const traceTurn: ITesterTraceTurn = {
          turn: turn + 1,
          tool_calls: [],
          tool_results: [],
        };

        // Verbose: record LLM request info
        if (verbose) {
          traceTurn.llm_request = { model: selectedModel, messages_count: summarizedContext.length };
        }

        const completionParams: any = {
          model: selectedModel,
          messages: summarizedContext,
          temperature: useTemperature,
          max_completion_tokens: maxTokens,
        };
        const minEffort =
          modelConfig?.reasoningEffort ??
          (modelConfig?.api === 'chat-completions' ? minReasoningEffortFor(selectedModel) : undefined);
        if (minEffort) {
          completionParams.reasoning_effort = minEffort;
        }
        if (functions.length > 0) {
          completionParams.tools = functions.map((fn) => ({ type: 'function' as const, function: fn }));
          completionParams.tool_choice = 'auto';
        }

        const response = await this.createModelResponse(llmClient, completionParams, modelConfig?.api);
        const choice = response.choices[0];
        if (!choice) {
          throw new Error('No response choice returned from OpenAI');
        }

        // Verbose: record LLM response info
        if (verbose) {
          const usage = response.usage
            ? {
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens,
              }
            : undefined;
          traceTurn.llm_response = {
            finish_reason: choice.finish_reason,
            content: choice.message.content ? truncateStr(choice.message.content, 2000) : null,
            ...(usage && { usage }),
          };
        }

        // Structured JSON logging for LLM response
        if (this.logJson) {
          console.log(
            JSON.stringify({
              event: 'llm_response',
              turn: turn + 1,
              finish_reason: choice.finish_reason,
              tool_calls: (choice.message.tool_calls ?? [])
                .filter((tc) => tc.type === 'function')
                .map((tc) => tc.function.name),
              has_content: !!choice.message.content,
              timestamp: new Date().toISOString(),
            }),
          );
        }

        summarizedContext.push(choice.message as OpenAI.Chat.ChatCompletionMessageParam);

        this.summaryMemory.pushMessage(summaryState, choice.message as OpenAI.Chat.ChatCompletionMessageParam);

        if (choice.message.content) {
          finalText = choice.message.content;
        }

        const toolCalls = choice.message.tool_calls ?? [];
        if (toolCalls.length === 0) {
          traceturns.push(traceTurn);
          break;
        }

        if (!mcpConfig) {
          finalText = finalText || 'Tools unavailable: no mcpConfig provided.';
          traceturns.push(traceTurn);
          break;
        }

        // Execute tool calls
        for (const tc of toolCalls) {
          if (tc.type !== 'function') {
            continue;
          }
          const functionName = tc.function?.name;
          if (!functionName) {
            continue;
          }

          const functionArgs = safeJsonParse(tc.function.arguments) as Record<string, unknown>;
          toolsUsed.push(functionName);

          // Record tool call in trace
          traceTurn.tool_calls.push({
            name: functionName,
            arguments: (functionArgs as { __parse_error?: boolean }).__parse_error
              ? ({ __parse_error: true } as any)
              : functionArgs,
          });

          // Structured JSON logging for tool call
          if (this.logJson) {
            console.log(
              JSON.stringify({
                event: 'tool_call',
                name: functionName,
                arguments: functionArgs,
                timestamp: new Date().toISOString(),
              }),
            );
          }

          if ((functionArgs as { __parse_error?: boolean }).__parse_error) {
            const errResult = { ok: false, error: 'Invalid JSON arguments' };
            traceTurn.tool_results.push({ name: functionName, result: errResult });
            const toolMsg = {
              role: 'tool' as const,
              tool_call_id: tc.id,
              content: truncateStr(errResult, toolLimitChars),
            };
            summarizedContext.push(toolMsg);

            this.summaryMemory.pushMessage(summaryState, toolMsg);
            continue;
          }

          const toolStartTime = Date.now();
          let toolResult: unknown;
          let toolFailed = false;
          try {
            toolResult = await this.mcpClientService.callToolWithConfig(mcpConfig, functionName, functionArgs);
          } catch (error) {
            logger.error(`Error executing MCP tool ${functionName}:`, error);
            toolFailed = true;
            toolResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
          const toolDuration = Date.now() - toolStartTime;

          if (appMode && mcpConfig && !toolFailed) {
            const toolDef = agentTools.find((t) => t.name === functionName);
            try {
              const appCall = await this.extractAppCall(
                toolDef,
                tc.id,
                functionName,
                functionArgs,
                toolResult,
                mcpConfig,
              );
              traceTurn.app_calls = traceTurn.app_calls || [];
              traceTurn.app_calls.push(appCall);
              appCalls.push(appCall);
            } catch (e) {
              logger.warn(`Failed to build appCall for ${functionName}:`, e);
            }
          }

          // Record tool result in trace (truncated for trace output)
          const truncatedResult = truncateStr(toolResult, maxResultChars);
          let parsedResult: unknown;
          try {
            parsedResult = JSON.parse(truncatedResult);
          } catch {
            parsedResult = truncatedResult;
          }
          traceTurn.tool_results.push({
            name: functionName,
            result: parsedResult,
            duration_ms: toolDuration,
          });

          // Structured JSON logging for tool result
          if (this.logJson) {
            console.log(
              JSON.stringify({
                event: 'tool_result',
                name: functionName,
                result: truncateStr(toolResult, maxResultChars),
                duration_ms: toolDuration,
                timestamp: new Date().toISOString(),
              }),
            );
          }

          const toolMsg = {
            role: 'tool' as const,
            tool_call_id: tc.id,
            content: truncateStr(toolResult, toolLimitChars),
          };
          summarizedContext.push(toolMsg);

          this.summaryMemory.pushMessage(summaryState, toolMsg);
        }

        traceturns.push(traceTurn);

        if (turn === maxTurns - 1 && toolCalls.length > 0) {
          finalText = finalText || 'Agent step limit reached. Increase maxTurns or refine your request.';
        }
      }

      if (!finalText) {
        finalText = 'Failed to get a text response from the agent.';
      }
      finalText = this.sanitizeResponseText(finalText);

      const totalDuration = Date.now() - startTime;

      // Structured JSON logging for final response
      if (this.logJson) {
        console.log(
          JSON.stringify({
            event: 'response',
            message: truncateStr(finalText, maxResultChars),
            tools_used: [...new Set(toolsUsed)],
            duration_ms: totalDuration,
          }),
        );
      }

      // Add assistant message to session
      session.messages.push({
        id: uuidv4(),
        text: finalText,
        sender: 'assistant',
        timestamp: new Date(),
        metadata: { response_time: totalDuration, tools_used: toolsUsed },
      });
      session.updatedAt = new Date();

      // Build trace
      let trace: ITesterTraceData = {
        system_prompt_sent: systemPromptSent,
        turns: traceturns,
        total_turns: traceturns.length,
        total_duration_ms: totalDuration,
        tools_used: [...new Set(toolsUsed)],
      };

      // Apply total trace size limit
      trace = this.truncateTraceData(trace, maxTraceChars);

      return { message: finalText, sessionId, trace, ...(appMode ? { appCalls } : {}) };
    } catch (error) {
      if (historyBefore) {
        Object.assign(this.summaryMemory.getState(sessionId), historyBefore);
      }
      logger.error('Error processing message with trace:', error);
      throw new Error(`Failed to process message: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        cause: error,
      });
    }
  }

  private sanitizeResponseText(text: string): string {
    return text.replace(/\n{6,}/g, '\n').trim();
  }

  private truncateTraceData(trace: ITesterTraceData, maxChars: number): ITesterTraceData {
    let serialized = JSON.stringify(trace);
    if (serialized.length <= maxChars) {
      return trace;
    }

    // Collapse older turns to summaries until we fit
    const turns = [...trace.turns];
    for (let i = 0; i < turns.length - 1; i++) {
      const t = turns[i]!;
      const toolNames = t.tool_calls.map((tc) => tc.name).join(', ');
      const hasErrors = t.tool_results.some((tr) => (tr.result as any)?.ok === false);
      const summary = toolNames ? `called ${toolNames} → ${hasErrors ? 'error' : 'success'}` : 'no tool calls';
      turns[i] = { turn: t.turn, tool_calls: [], tool_results: [], summary } as any;

      const candidate = { ...trace, turns };
      serialized = JSON.stringify(candidate);
      if (serialized.length <= maxChars) {
        return candidate;
      }
    }

    return { ...trace, turns };
  }

  public getSession(sessionId: string): ITesterChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getAllSessions(): ITesterChatSession[] {
    return Array.from(this.sessions.values());
  }

  public deleteSession(sessionId: string): boolean {
    this.historyRoutes.delete(sessionId);
    this.summaryMemory.delete(sessionId);
    return this.sessions.delete(sessionId);
  }

  private createSession(sessionId: string, agentPrompt?: string, mcpServerUrl?: string): ITesterChatSession {
    const session: ITesterChatSession = {
      id: sessionId,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (agentPrompt) {
      session.agentPrompt = agentPrompt;
    }
    if (mcpServerUrl) {
      session.mcpServerUrl = mcpServerUrl;
    }

    logger.info(`Created new session: ${sessionId}`);
    return session;
  }
}
