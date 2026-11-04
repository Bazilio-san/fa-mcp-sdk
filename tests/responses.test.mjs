import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createResponse, responseInput } from '../dist/core/agent-tester/services/ResponsesClient.js';
import { SummaryMemory } from '../dist/core/agent-tester/services/SummaryMemory.js';

test('preserves reasoning and multiple function calls across turns', async () => {
  const output = [
    { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque' },
    ...['a', 'b'].map((name) => ({ type: 'function_call', name, call_id: name, arguments: '{}' })),
  ];
  let request;
  const client = {
    responses: {
      create: async (body) => {
        request = body;
        return {
          status: 'completed',
          output,
          output_text: '',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
            input_tokens_details: { cached_tokens: 2 },
            output_tokens_details: { reasoning_tokens: 3 },
          },
        };
      },
    },
  };
  const result = await createResponse(client, {
    model: 'example',
    messages: [{ role: 'user', content: 'hello' }],
    max_completion_tokens: 100,
    tools: [{ type: 'function', function: { name: 'a', parameters: { type: 'object' } } }],
  });
  assert.equal(request.store, false);
  assert.deepEqual(request.include, ['reasoning.encrypted_content']);
  assert.equal(request.tools[0].name, 'a');
  assert.equal(request.tools[0].strict, false);
  assert.equal(request.max_output_tokens, 100);
  assert.ok(!('temperature' in request));
  assert.equal(result.usage.reasoning_tokens, 3);
  assert.deepEqual(
    responseInput([
      result.choices[0].message,
      { role: 'tool', tool_call_id: 'a', content: 'ok' },
      { role: 'tool', tool_call_id: 'b', content: 'error' },
    ]),
    [
      ...output,
      { type: 'function_call_output', call_id: 'a', output: 'ok' },
      { type: 'function_call_output', call_id: 'b', output: 'error' },
    ],
  );
});

test('rejects incomplete and refused responses without silently changing API', async () => {
  for (const response of [
    { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    { status: 'failed', error: { message: 'failure' } },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] },
  ]) {
    await assert.rejects(
      createResponse({ responses: { create: async () => response } }, { model: 'example', messages: [] }),
    );
  }
});

test('keeps whole turns until successful compression', () => {
  const memory = new SummaryMemory({ tailSize: 3 });
  const state = memory.getState('test');
  for (let i = 0; i < 3; i++) {
    memory.pushMessage(state, { role: 'user', content: String(i) });
    memory.pushMessage(state, { role: 'assistant', content: 'done' });
  }
  assert.equal(state.tail.length, 6);
  assert.equal(memory.needsCompression(state), true);
  assert.equal(state.compressionCount, 2);
  memory.resetAfterCompression(state);
  assert.equal(state.tail.length, 4);
  assert.equal(state.tail[0].role, 'user');
  assert.ok(state.estimatedTokens > 0);
});

test('ships identical rules and all task directories in template', () => {
  for (const name of ['GIT-WORKTREE-RULES', 'LONG-RUNNING-JOBS', 'PROMPT-PLAN-RULES', 'PROMPT-RULES']) {
    const file = `AGENTS-${name}.md`;
    assert.equal(readFileSync(file, 'utf8'), readFileSync(`cli-template/${file}`, 'utf8'));
    for (const base of ['', 'cli-template/']) {
      assert.ok(readFileSync(`${base}AGENTS.md`, 'utf8').includes(file));
    }
  }
  for (const base of ['', 'cli-template/']) {
    for (const folder of ['done', '_shelf', '_progress', '_future']) {
      assert.ok(existsSync(`${base}_prompts/${folder}/.gitkeep`));
    }
  }
});

test('agent executes both entry points, continues context and resets on model change', async () => {
  const { TesterAgentService } = await import('../dist/core/agent-tester/services/TesterAgentService.js');
  const tools = [{ name: 'lookup', description: 'lookup', inputSchema: { type: 'object', properties: {} } }];
  let executions = 0;
  const service = new TesterAgentService({
    getOrCreateClient: async () => ({ tools }),
    callToolWithConfig: async () => {
      executions++;
      return { content: [{ type: 'text', text: 'found' }] };
    },
  });
  const requests = [];
  service.openai = {
    responses: {
      create: async (body) => {
        requests.push(body);
        if (requests.length === 1) {
          return {
            status: 'completed',
            output_text: '',
            output: [
              { type: 'reasoning', id: 'r', summary: [], encrypted_content: 'opaque' },
              { type: 'function_call', name: 'lookup', call_id: 'call', arguments: '{}' },
            ],
          };
        }
        return {
          status: 'completed',
          output_text: 'done',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }],
        };
      },
    },
  };
  const request = {
    sessionId: 'session',
    message: 'find',
    mcpConfig: { url: 'http://example', transport: 'http' },
    modelConfig: { model: 'example' },
  };
  const first = await service.processMessage(request);
  assert.equal(first.message, 'done');
  assert.deepEqual(first.metadata.tools_used, ['lookup']);
  assert.equal(executions, 1);
  assert.ok(requests[1].input.some((item) => item.type === 'function_call_output' && item.call_id === 'call'));
  assert.ok(requests[1].input.some((item) => item.type === 'reasoning'));
  const next = await service.processMessageWithTrace({ ...request, message: 'continue' });
  assert.equal(next.message, 'done');
  assert.ok(requests[2].input.some((item) => item.type === 'function_call_output'));
  await service.processMessage({ ...request, modelConfig: { model: 'another' } });
  assert.ok(!requests[3].input.some((item) => item.type === 'function_call_output'));
  const before = structuredClone(service.summaryMemory.getState('session'));
  service.openai.responses.create = async () => {
    throw new Error('unavailable');
  };
  await assert.rejects(service.processMessage({ ...request, modelConfig: { model: 'another' } }));
  assert.deepEqual(service.summaryMemory.getState('session'), before);
  await service.cleanup();
});
