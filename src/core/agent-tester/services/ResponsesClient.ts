import OpenAI from 'openai';

// Preserve provider items verbatim across turns, including encrypted reasoning.
export type HistoryMessage = OpenAI.Chat.ChatCompletionMessageParam & {
  responseOutput?: OpenAI.Responses.ResponseOutputItem[];
};

export function responseInput(messages: HistoryMessage[]): OpenAI.Responses.ResponseInput {
  return messages.flatMap((message): OpenAI.Responses.ResponseInputItem[] => {
    if (message.responseOutput) {
      return message.responseOutput as OpenAI.Responses.ResponseInputItem[];
    }
    if (message.role === 'tool') {
      return [{ type: 'function_call_output', call_id: message.tool_call_id, output: String(message.content) }];
    }
    if (message.role === 'function') {
      throw new Error('Unsupported function history message');
    }
    return [{ role: message.role, content: message.content ?? '' } as OpenAI.Responses.ResponseInputItem];
  });
}

export async function createResponse(
  client: OpenAI,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  api: 'responses' | 'chat-completions' = 'responses',
) {
  if (api === 'chat-completions') {
    const response = await client.chat.completions.create(params);
    const choice = response.choices[0];
    if (!choice || !['stop', 'tool_calls'].includes(choice.finish_reason)) {
      throw new Error(`Incomplete model response: ${choice?.finish_reason}`);
    }
    if (choice.message.refusal) {
      throw new Error(`Model refused: ${choice.message.refusal}`);
    }
    return {
      choices: [
        { message: { ...choice.message, content: choice.message.content ?? '' }, finish_reason: choice.finish_reason },
      ],
      usage: response.usage,
    };
  }
  const response = await client.responses.create({
    model: params.model,
    input: responseInput(params.messages),
    store: false,
    include: ['reasoning.encrypted_content'],
    ...(params.max_completion_tokens ? { max_output_tokens: params.max_completion_tokens } : {}),
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.reasoning_effort ? { reasoning: { effort: params.reasoning_effort } } : {}),
    ...(params.tools?.length
      ? {
          tools: params.tools.map((tool) => {
            if (tool.type !== 'function') {
              throw new Error('Unsupported tool type');
            }
            return {
              type: 'function' as const,
              ...tool.function,
              parameters: tool.function.parameters ?? {},
              strict: false,
            };
          }),
          tool_choice: 'auto' as const,
        }
      : {}),
  });
  if (response.status !== 'completed') {
    throw new Error(
      `Model response ${response.status}: ${JSON.stringify(response.incomplete_details ?? response.error)}`,
    );
  }
  const refusal = response.output
    .flatMap((item) => (item.type === 'message' ? item.content : []))
    .find((part) => part.type === 'refusal');
  if (refusal) {
    throw new Error(`Model refused: ${refusal.refusal}`);
  }
  const calls = response.output
    .filter((item) => item.type === 'function_call')
    .map((item) => ({
      id: item.call_id,
      type: 'function' as const,
      function: { name: item.name, arguments: item.arguments },
    }));
  const message = {
    role: 'assistant',
    content: response.output_text,
    tool_calls: calls,
    responseOutput: response.output,
  } satisfies HistoryMessage;
  return {
    choices: [{ message, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
    usage: response.usage
      ? {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
          cached_tokens: response.usage.input_tokens_details.cached_tokens,
          reasoning_tokens: response.usage.output_tokens_details.reasoning_tokens,
        }
      : undefined,
  };
}
