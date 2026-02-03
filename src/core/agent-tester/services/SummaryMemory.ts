import OpenAI from 'openai';

export type SummaryState = {
  summary: string;
  tail: OpenAI.Chat.ChatCompletionMessageParam[];
  estimatedTokens: number;
  lastSummarizedAt: Date;
};

export type SummaryConfig = {
  tailSize: number;
  maxTokens: number;
  maxToolPayloadChars: number;
};

const DEFAULT_CONFIG: SummaryConfig = {
  tailSize: 6,
  maxTokens: 8000,
  maxToolPayloadChars: 5000,
};

export class SummaryMemory {
  private map: Map<string, SummaryState> = new Map();
  private config: SummaryConfig;

  constructor (config?: Partial<SummaryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  public getState (sessionId: string): SummaryState {
    let state = this.map.get(sessionId);
    if (!state) {
      state = {
        summary: '',
        tail: [],
        estimatedTokens: 0,
        lastSummarizedAt: new Date(0),
      };
      this.map.set(sessionId, state);
    }
    return state;
  }

  public delete (sessionId: string): void {
    this.map.delete(sessionId);
  }

  public clear (): void {
    this.map.clear();
  }

  public buildMessages (systemPrompt: string, state: SummaryState): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (state.summary) {
      messages.push({ role: 'system', content: `Summary Memory:\n${state.summary}` });
    }

    messages.push(...state.tail);
    return messages;
  }

  public pushMessage (state: SummaryState, msg: OpenAI.Chat.ChatCompletionMessageParam): void {
    const normalized = this.normalizeToolPayload(msg);
    state.tail.push(normalized);
    state.estimatedTokens += this.estimateTokens(normalized);

    if (state.tail.length > this.config.tailSize) {
      const removed = state.tail.splice(0, state.tail.length - this.config.tailSize);
      for (const r of removed) {
        state.estimatedTokens -= this.estimateTokens(r);
      }
      if (state.estimatedTokens < 0) {
        state.estimatedTokens = 0;
      }
    }
  }

  public needsCompression (state: SummaryState): boolean {
    return state.estimatedTokens > this.config.maxTokens;
  }

  public getConfig (): SummaryConfig {
    return this.config;
  }

  public resetAfterCompression (state: SummaryState): void {
    state.estimatedTokens = 0;
    state.lastSummarizedAt = new Date();
  }

  private normalizeToolPayload (
    msg: OpenAI.Chat.ChatCompletionMessageParam,
  ): OpenAI.Chat.ChatCompletionMessageParam {
    if (msg.role !== 'tool' || typeof msg.content !== 'string') {
      return msg;
    }

    if (msg.content.length <= this.config.maxToolPayloadChars) {
      return msg;
    }

    const truncated = [
      msg.content.slice(0, this.config.maxToolPayloadChars),
      '',
      `[TRUNCATED tool result: original_length=${msg.content.length} chars, kept=${this.config.maxToolPayloadChars}]`,
    ].join('\n');

    return { ...msg, content: truncated };
  }

  private estimateTokens (msg: OpenAI.Chat.ChatCompletionMessageParam): number {
    const text = JSON.stringify(msg);
    // Rough estimate: 1 token ~= 4 characters
    return Math.ceil(text.length / 4);
  }
}
