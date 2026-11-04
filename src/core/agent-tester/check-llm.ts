import OpenAI from 'openai';

import { appConfig } from '../bootstrap/init-config.js';
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
    timeout: 30000,
    maxRetries: 0,
    ...(baseURL ? { baseURL: baseURL } : {}),
  };

  const openai = new OpenAI(cfg);
  const data = {
    model: model || appConfig.agentTester?.openAi?.defaultModel || 'gpt-6-luna',
    input: 'Hi',
    store: false,
    max_output_tokens: 100,
  };
  try {
    const response = await openai.responses.create(data);
    if (response.status !== 'completed') {
      throw new Error(`Model response: ${response.status}`);
    }
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
