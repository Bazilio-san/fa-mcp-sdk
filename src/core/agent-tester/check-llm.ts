import OpenAI from 'openai';
import { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';

import { appConfig } from '../bootstrap/init-config.js';
import { logInternalError } from '../errors/errors.js';
import { isMainModule } from '../utils/utils.js';

export async function checkLlm(model?: string): Promise<boolean> {
  const apiKey = appConfig.agentTester?.openAi?.apiKey?.trim();
  const baseURL = appConfig.agentTester?.openAi?.baseURL?.trim();
  if (!apiKey) {
    console.error('FAIL: OpenAI API key is not configured');
    return false;
  }
  const cfg = {
    apiKey,
    ...(baseURL ? { baseURL: baseURL } : {}),
  };

  const openai = new OpenAI(cfg);
  const data: ChatCompletionCreateParamsNonStreaming = {
    model: model || 'gpt-4.1' || 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 100,
  };
  try {
    await openai.chat.completions.create(data);
    console.log('API key configured: true');
    console.log('OK');
    return true;
  } catch (err: unknown) {
    logInternalError(err, 'llm_check');
    console.error('FAIL: OpenAI API request failed');
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  checkLlm(process.argv[2]).then((ok) => process.exit(ok ? 0 : 1));
}
