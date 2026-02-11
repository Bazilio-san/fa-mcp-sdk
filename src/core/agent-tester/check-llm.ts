import { appConfig } from '../bootstrap/init-config.js';
import { isMainModule } from '../utils/utils.js';
import OpenAI from 'openai';
import {
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';

export async function checkLlm (model?: string): Promise<boolean> {
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
    console.log(`API KEY: ${cfg.apiKey.substring(0, 15)}...${cfg.apiKey.substr(-4)}`);
    console.log('OK');
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: ${msg}`);
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  checkLlm(process.argv[2]).then((ok) => process.exit(ok ? 0 : 1));
}
