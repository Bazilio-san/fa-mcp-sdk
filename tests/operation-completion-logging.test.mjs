/** Regression coverage for structured prompt/resource completion traces. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const traceDir = mkdtempSync(join(tmpdir(), 'fa-mcp-operation-trace-'));
const traceFile = join(traceDir, 'operations.jsonl');
const PROMPT_REQUEST_SECRET = 'raw-requested-prompt-must-not-enter-logs';
const PROMPT_ARGUMENT_SECRET = 'prompt-argument-must-not-enter-logs';
const PROMPT_EXCEPTION_SECRET = 'prompt-exception-message-must-not-enter-logs';
const RESOURCE_URI_SECRET = 'private://resource-uri-must-not-enter-logs';
const RESOURCE_EXCEPTION_SECRET = 'resource-exception-message-must-not-enter-logs';

const failures = {
  promptResolver: false,
  resourceResolver: false,
};

globalThis.__MCP_PROJECT_DATA__ = {
  tools: [],
  toolHandler: async () => ({ content: [] }),
  agentBrief: 'Brief content that must not enter completion logs.',
  agentPrompt: 'Prompt content that must not enter completion logs.',
  customPrompts: async () => {
    if (failures.promptResolver) {
      throw new Error(PROMPT_EXCEPTION_SECRET);
    }
    return [
      {
        name: 'throwing_prompt',
        description: 'Server-declared prompt metadata.',
        arguments: [{ name: 'secret', required: false }],
        content: async () => {
          throw new Error(PROMPT_EXCEPTION_SECRET);
        },
      },
    ];
  },
  customResources: async () => {
    if (failures.resourceResolver) {
      throw new Error(RESOURCE_EXCEPTION_SECRET);
    }
    return [
      {
        uri: 'private://operation-log-test',
        name: 'operation-log-resource',
        description: 'Resource used to verify completion trace metadata.',
        mimeType: 'application/json',
        content: { secretValue: 'must-not-enter-completion-logs' },
      },
      {
        uri: 'private://throwing-resource',
        name: 'throwing-resource',
        description: 'Server-declared resource metadata.',
        mimeType: 'text/plain',
        content: async () => {
          throw new Error(RESOURCE_EXCEPTION_SECRET);
        },
      },
    ];
  },
};

const { configureDebugSink, traceDigest } = await import('../dist/core/mcp/debug-trace.js');
const { getPrompt, getPromptsList } = await import('../dist/core/mcp/prompts.js');
const { getResource, getResourcesList } = await import('../dist/core/mcp/resources.js');

const transportContext = { transport: 'http' };

function readEvents() {
  if (!existsSync(traceFile)) {
    return [];
  }
  return readFileSync(traceFile, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForEvents(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const events = readEvents();
    if (predicate(events)) {
      return events;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return readEvents();
}

configureDebugSink(traceFile);
try {
  await getPromptsList(transportContext);
  await getResourcesList(transportContext);
  await getPrompt({ params: { name: 'agent_prompt' } }, transportContext);
  await getResource('private://operation-log-test', transportContext);

  failures.promptResolver = true;
  await assert.rejects(() => getPromptsList(transportContext), new RegExp(PROMPT_EXCEPTION_SECRET));
  await assert.rejects(
    () =>
      getPrompt(
        { params: { name: PROMPT_REQUEST_SECRET, arguments: { secret: PROMPT_ARGUMENT_SECRET } } },
        transportContext,
      ),
    new RegExp(PROMPT_EXCEPTION_SECRET),
  );
  failures.promptResolver = false;
  await assert.rejects(
    () =>
      getPrompt(
        { params: { name: 'throwing_prompt', arguments: { secret: PROMPT_ARGUMENT_SECRET } } },
        transportContext,
      ),
    new RegExp(PROMPT_EXCEPTION_SECRET),
  );

  failures.resourceResolver = true;
  await assert.rejects(() => getResourcesList(transportContext), new RegExp(RESOURCE_EXCEPTION_SECRET));
  await assert.rejects(() => getResource(RESOURCE_URI_SECRET, transportContext), new RegExp(RESOURCE_EXCEPTION_SECRET));
  failures.resourceResolver = false;
  await assert.rejects(
    () => getResource('private://throwing-resource', transportContext),
    new RegExp(RESOURCE_EXCEPTION_SECRET),
  );

  const events = await waitForEvents(
    (entries) =>
      entries.filter((event) => event.kind === 'list-err').length >= 2 &&
      entries.filter((event) => event.kind === 'get-err').length >= 2 &&
      entries.filter((event) => event.kind === 'read-err').length >= 2,
  );

  const promptCompletion = events.find((event) => event.ch === 'mcp:prompt' && event.kind === 'get-res');
  assert.ok(promptCompletion, 'prompt completion trace was not written');
  assert.equal(promptCompletion.name, 'agent_prompt');
  assert.match(promptCompletion.nameHash, /^[a-f0-9]{12}$/);
  assert.equal(promptCompletion.status, 'success');
  assert.equal(typeof promptCompletion.ms, 'number');

  const resourceCompletion = events.find((event) => event.ch === 'mcp:resource' && event.kind === 'read-res');
  assert.ok(resourceCompletion, 'resource completion trace was not written');
  assert.equal(resourceCompletion.name, 'operation-log-resource');
  assert.match(resourceCompletion.uriHash, /^[a-f0-9]{12}$/);
  assert.equal(resourceCompletion.status, 'success');
  assert.equal(typeof resourceCompletion.ms, 'number');

  const promptListFailure = events.find((event) => event.ch === 'mcp:prompt' && event.kind === 'list-err');
  assert.equal(promptListFailure?.name, '*');
  assert.equal(promptListFailure?.status, 'error');

  const promptResolverFailure = events.find(
    (event) => event.ch === 'mcp:prompt' && event.kind === 'get-err' && event.name === 'unknown',
  );
  assert.equal(promptResolverFailure?.nameHash, traceDigest(PROMPT_REQUEST_SECRET));
  assert.equal(promptResolverFailure?.status, 'error');

  const promptContentFailure = events.find(
    (event) => event.ch === 'mcp:prompt' && event.kind === 'get-err' && event.name === 'throwing_prompt',
  );
  assert.equal(promptContentFailure?.status, 'error');

  const resourceListFailure = events.find((event) => event.ch === 'mcp:resource' && event.kind === 'list-err');
  assert.equal(resourceListFailure?.name, '*');
  assert.equal(resourceListFailure?.status, 'error');

  const resourceResolverFailure = events.find(
    (event) => event.ch === 'mcp:resource' && event.kind === 'read-err' && event.name === 'unknown',
  );
  assert.equal(resourceResolverFailure?.uriHash, traceDigest(RESOURCE_URI_SECRET));
  assert.equal(resourceResolverFailure?.status, 'error');

  const resourceContentFailure = events.find(
    (event) => event.ch === 'mcp:resource' && event.kind === 'read-err' && event.name === 'throwing-resource',
  );
  assert.equal(resourceContentFailure?.status, 'error');

  const serialized = JSON.stringify(events);
  assert.doesNotMatch(
    serialized,
    new RegExp(
      [
        'Prompt content',
        'Brief content',
        PROMPT_REQUEST_SECRET,
        PROMPT_ARGUMENT_SECRET,
        PROMPT_EXCEPTION_SECRET,
        RESOURCE_URI_SECRET,
        RESOURCE_EXCEPTION_SECRET,
        'private://operation-log-test',
        'private://throwing-resource',
        'must-not-enter-completion-logs',
      ].join('|'),
    ),
  );
  console.log('Prompt/resource completions cover success and exceptions without request/content leakage.');
} finally {
  configureDebugSink(null);
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(traceDir, { recursive: true, force: true });
}
