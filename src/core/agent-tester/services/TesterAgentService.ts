import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import { logger as lgr } from '../../logger.js';
import {
  TesterChatMessage,
  TesterChatSession,
  TesterMcpTool,
  TesterChatRequest,
  TesterChatResponse,
  TesterCachedMcpClient,
} from '../types.js';
import { TesterMcpClientService } from './TesterMcpClientService.js';
import { SummaryMemory, SummaryState } from './SummaryMemory.js';

const logger = lgr.getSubLogger({ name: chalk.cyan('agent-tester:agent') });

interface AgentConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  maxTurns: number;
  toolResultLimitChars: number;
  tools: TesterMcpTool[];
  mcpServerUrl?: string;
}

export class TesterAgentService {
  private sessions: Map<string, TesterChatSession> = new Map();
  private defaultConfig: AgentConfig;
  private openai: OpenAI | null = null;

  private openaiHistories: Map<string, OpenAI.Chat.ChatCompletionMessageParam[]> = new Map();

  private summaryMemory = new SummaryMemory({
    tailSize: 6,
    maxTokens: 8000,
    maxToolPayloadChars: 5000,
  });

  constructor (
    private mcpClientService: TesterMcpClientService,
    private openAiConfig?: { apiKey?: string; baseUrl?: string },
  ) {
    this.defaultConfig = {
      model: 'gpt-4o-mini',
      systemPrompt: 'You are a helpful AI assistant that can use MCP tools to help users.',
      temperature: 0.3,
      maxTokens: 4096,
      maxTurns: 10,
      toolResultLimitChars: 40000,
      tools: [],
    };

    if (openAiConfig?.apiKey) {
      this.openai = new OpenAI({
        apiKey: openAiConfig.apiKey,
        ...(openAiConfig.baseUrl ? { baseURL: openAiConfig.baseUrl } : {}),
      });
    }
  }

  public async cleanup (): Promise<void> {
    logger.info('Cleaning up TesterAgentService');
    this.sessions.clear();
    this.openaiHistories.clear();
    this.summaryMemory.clear();
  }

  private buildSummaryPrompt (): string {
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

  private async summarizeHistory (
    llmClient: OpenAI,
    state: SummaryState,
    model: string,
  ): Promise<void> {
    const summaryPrompt = this.buildSummaryPrompt();
    const payload = JSON.stringify(state.tail);

    const response = await llmClient.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: summaryPrompt },
        { role: 'user', content: `OLD SUMMARY:\n${state.summary || '(empty)'}\n\nNEW MESSAGES(JSON):\n${payload}` },
      ],
      temperature: 0.2,
      max_completion_tokens: 800,
    });

    state.summary = response.choices[0]?.message?.content?.trim() || state.summary;
    this.summaryMemory.resetAfterCompression(state);
  }

  public async processMessage (request: TesterChatRequest): Promise<TesterChatResponse> {
    const startTime = Date.now();
    const sessionId = request.sessionId || uuidv4();

    try {
      const mcpConfig = request.mcpConfig;
      const mcpServerUrl = mcpConfig?.url || request.mcpServerUrl;

      // Get or create session
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = this.createSession(sessionId, request.systemPrompt, mcpServerUrl);
        this.sessions.set(sessionId, session);
      }

      // Add user message to session
      const userMessage: TesterChatMessage = {
        id: uuidv4(),
        text: request.message,
        sender: 'user',
        timestamp: new Date(),
      };
      session.messages.push(userMessage);

      // Get tools and agentPrompt from cached client
      let cachedClient: TesterCachedMcpClient | null = null;
      let agentTools: TesterMcpTool[] = [];

      if (mcpConfig) {
        try {
          cachedClient = await this.mcpClientService.getOrCreateClient(mcpConfig);
          agentTools = cachedClient.tools;
          logger.info(`Using cached MCP client with ${agentTools.length} tools`);
        } catch (error) {
          logger.error('Failed to get MCP client:', error);
        }
      }

      // Prepare system prompt
      let systemPrompt = request.systemPrompt || session.systemPrompt || this.defaultConfig.systemPrompt;
      const { agentPrompt } = cachedClient || {};
      if (agentPrompt && agentPrompt !== systemPrompt) {
        systemPrompt = [
          agentPrompt,
          '',
          systemPrompt,
        ].filter(Boolean).join('\n\n');
      }

      if (request.customPrompt && request.customPrompt.trim()) {
        systemPrompt += '\n\n' + request.customPrompt.trim();
      }

      // Get model configuration
      const modelConfig = request.modelConfig;
      const selectedModel = modelConfig?.model || request.model || this.defaultConfig.model;
      const temperature = modelConfig?.temperature ?? this.defaultConfig.temperature;
      const maxTokens = modelConfig?.maxTokens ?? this.defaultConfig.maxTokens;

      // Create OpenAI client - use custom baseUrl/apiKey if provided
      let llmClient: OpenAI;
      let isCustomLlm = false;
      if (modelConfig?.baseUrl && modelConfig?.apiKey) {
        llmClient = new OpenAI({
          baseURL: modelConfig.baseUrl,
          apiKey: modelConfig.apiKey,
        });
        isCustomLlm = true;
        logger.info(`Using custom LLM: ${modelConfig.baseUrl}`);
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

      // Use persistent history
      let openaiMessages = this.openaiHistories.get(sessionId);
      if (!openaiMessages) {
        openaiMessages = [];
        this.openaiHistories.set(sessionId, openaiMessages);
      }

      // Update system prompt
      if (openaiMessages.length === 0) {
        openaiMessages.push({ role: 'system', content: systemPrompt });
      } else if (openaiMessages[0]?.role === 'system') {
        openaiMessages[0] = { role: 'system', content: systemPrompt };
      } else {
        openaiMessages.unshift({ role: 'system', content: systemPrompt });
      }

      openaiMessages.push({ role: 'user', content: request.message });

      // Get summary state
      const summaryState = this.summaryMemory.getState(sessionId);
      this.summaryMemory.pushMessage(summaryState, { role: 'user', content: request.message });

      if (this.summaryMemory.needsCompression(summaryState)) {
        await this.summarizeHistory(llmClient, summaryState, selectedModel);
      }

      const summarizedContext = this.summaryMemory.buildMessages(systemPrompt, summaryState);

      const useTemperature = selectedModel.startsWith('gpt-5') ? null : temperature;

      let finalText = '';
      const toolsUsed: string[] = [];

      const safeJsonParse = (raw: string | undefined): unknown => {
        if (!raw || !raw.trim()) {
          return {};
        }
        try {
          return JSON.parse(raw);
        } catch {
          return { __parse_error: true, raw };
        }
      };

      const toolLimitChars =
        modelConfig?.toolResultLimitChars ?? this.defaultConfig.toolResultLimitChars ?? 20000;

      const truncateForToolMessage = (value: unknown, limitChars = toolLimitChars): string => {
        let str: string;
        try {
          str = typeof value === 'string' ? value : JSON.stringify(value);
        } catch {
          str = String(value);
        }

        if (str.length <= limitChars) {
          return str;
        }

        return [
          str.slice(0, limitChars),
          '',
          `[TRUNCATED tool result: original_length=${str.length} chars, kept=${limitChars}]`,
        ].join('\n');
      };

      const serializeForLog = (msgs: OpenAI.Chat.ChatCompletionMessageParam[]): string => {
        return JSON.stringify(
          msgs.map((m) => {
            if (m.role !== 'tool') {
              return m;
            }
            return {
              ...m,
              content: truncateForToolMessage(m.content, toolLimitChars),
            };
          }),
          null,
          2,
        );
      };

      // Log request
      console.log(chalk.blue(`${chalk.bgWhite.bold('🔵 LLM REQUEST:')}
Model: ${selectedModel}${isCustomLlm ? ' (custom)' : ''}
Base URL: ${modelConfig?.baseUrl || 'OpenAI default'}
Temperature: ${temperature}
Max Tokens: ${maxTokens}
Session ID: ${sessionId}
MCP Server: ${mcpServerUrl || 'None'}
Tools: ${agentTools.length}
Messages: ${serializeForLog(openaiMessages)}
`));

      const maxTurns = modelConfig?.maxTurns ?? this.defaultConfig.maxTurns ?? 10;

      for (let turn = 0; turn < maxTurns; turn++) {
        console.log(chalk.cyan(`${chalk.bgBlue.bold(`🔄 LLM REQUEST [Turn ${turn + 1}/${maxTurns}]:`)}
Model: ${selectedModel}${isCustomLlm ? ' (custom)' : ''}
Messages count: ${summarizedContext.length}
Messages: ${serializeForLog(summarizedContext)}
`));

        const completionParams: any = {
          model: selectedModel,
          messages: summarizedContext,
          temperature: useTemperature,
          max_completion_tokens: maxTokens,
        };
        if (functions.length > 0) {
          completionParams.tools = functions.map((fn) => ({
            type: 'function' as const,
            function: fn,
          }));
          completionParams.tool_choice = 'auto';
        }

        const response = await llmClient.chat.completions.create(completionParams);

        const choice = response.choices[0];
        if (!choice) {
          throw new Error('No response choice returned from OpenAI');
        }

        // Log response
        const toolCallsInResponse = choice.message.tool_calls ?? [];
        const toolCallNames = toolCallsInResponse
          .filter((tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: 'function' } => tc.type === 'function')
          .map(tc => tc.function.name);
        console.log(chalk.magenta(`${chalk.bgMagenta.bold(`🟣 LLM RESPONSE [Turn ${turn + 1}/${maxTurns}]:`)}
Finish reason: ${choice.finish_reason}
Tool calls: ${toolCallNames.length > 0 ? toolCallNames.join(', ') : 'None'}
Content: ${choice.message.content ? choice.message.content.substring(0, 500) + (choice.message.content.length > 500 ? '...' : '') : '(no text content)'}
Usage: ${response.usage ? `prompt=${response.usage.prompt_tokens}, completion=${response.usage.completion_tokens}, total=${response.usage.total_tokens}` : 'N/A'}
`));

        summarizedContext.push(choice.message as OpenAI.Chat.ChatCompletionMessageParam);
        openaiMessages.push(choice.message as OpenAI.Chat.ChatCompletionMessageParam);
        this.summaryMemory.pushMessage(summaryState, choice.message as OpenAI.Chat.ChatCompletionMessageParam);

        if (choice.message.content) {
          finalText = choice.message.content;
        }

        const toolCalls = choice.message.tool_calls ?? [];
        if (toolCalls.length === 0) {
          break;
        }

        if (!mcpConfig) {
          finalText = finalText || 'Tools unavailable: no mcpConfig provided.';
          break;
        }

        // Execute all tool calls
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

          if ((functionArgs as { __parse_error?: boolean }).__parse_error) {
            const toolMsg = {
              role: 'tool' as const,
              tool_call_id: tc.id,
              content: truncateForToolMessage(
                { ok: false, error: 'Invalid JSON arguments', raw: (functionArgs as { raw?: string }).raw },
                toolLimitChars,
              ),
            };
            summarizedContext.push(toolMsg);
            openaiMessages.push(toolMsg);
            this.summaryMemory.pushMessage(summaryState, toolMsg);
            continue;
          }

          console.log(chalk.green(`${chalk.bgGreen.bold(`🔧 TOOL CALL [${functionName}]:`)}
Arguments: ${JSON.stringify(functionArgs, null, 2).substring(0, 1000)}
`));

          let toolResult: unknown;
          try {
            toolResult = await this.mcpClientService.callToolWithConfig(
              mcpConfig,
              functionName,
              functionArgs,
            );
          } catch (error) {
            logger.error(`Error executing MCP tool ${functionName}:`, error);
            toolResult = {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }

          const toolResultStr = truncateForToolMessage(toolResult, 2000);
          console.log(chalk.greenBright(`${chalk.bgGreen.bold(`🔧 TOOL RESULT [${functionName}]:`)}
Result: ${toolResultStr}
`));

          const toolMsg = {
            role: 'tool' as const,
            tool_call_id: tc.id,
            content: truncateForToolMessage(toolResult, toolLimitChars),
          };
          summarizedContext.push(toolMsg);
          openaiMessages.push(toolMsg);
          this.summaryMemory.pushMessage(summaryState, toolMsg);
        }

        if (turn === maxTurns - 1 && toolCalls.length > 0) {
          finalText = finalText || 'Agent step limit reached. Increase maxTurns or refine your request.';
        }
      }

      if (!finalText) {
        finalText = 'Failed to get a text response from the agent.';
      }

      console.log(chalk.yellow(`${chalk.bgBlack.bold('🟡 LLM RESPONSE:')}
Response Time: ${Date.now() - startTime}ms
Tools Used: ${toolsUsed.length > 0 ? toolsUsed.join(', ') : 'None'}
Response Text: ${finalText}
`));

      // Add assistant message to session
      const assistantMessage: TesterChatMessage = {
        id: uuidv4(),
        text: finalText,
        sender: 'assistant',
        timestamp: new Date(),
        metadata: {
          response_time: Date.now() - startTime,
          tools_used: toolsUsed,
        },
      };
      session.messages.push(assistantMessage);
      session.updatedAt = new Date();

      return {
        id: assistantMessage.id,
        message: finalText,
        sessionId: sessionId,
        metadata: {
          response_time: Date.now() - startTime,
          tools_used: toolsUsed,
          ...(mcpServerUrl && { mcp_server: mcpServerUrl }),
        },
      };

    } catch (error) {
      logger.error('Error processing message:', error);
      throw new Error(`Failed to process message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public getSession (sessionId: string): TesterChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getAllSessions (): TesterChatSession[] {
    return Array.from(this.sessions.values());
  }

  public deleteSession (sessionId: string): boolean {
    this.openaiHistories.delete(sessionId);
    this.summaryMemory.delete(sessionId);
    return this.sessions.delete(sessionId);
  }

  private createSession (sessionId: string, systemPrompt?: string, mcpServerUrl?: string): TesterChatSession {
    const session: TesterChatSession = {
      id: sessionId,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (systemPrompt) {
      session.systemPrompt = systemPrompt;
    }
    if (mcpServerUrl) {
      session.mcpServerUrl = mcpServerUrl;
    }

    logger.info(`Created new session: ${sessionId}`);
    return session;
  }
}
