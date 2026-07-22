/** Required-scope metadata is strict, fail-closed, and resolved once per protected read. */
process.env.NODE_CONFIG = JSON.stringify({
  mcp: { completions: { enabled: true }, resources: { templatesEnabled: true } },
  webServer: { auth: { enabled: true, jwtToken: { encryptKey: '***' } } },
});

import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ResultSchema } from '@modelcontextprotocol/sdk/types.js';

const { createMcpServer } = await import('../dist/core/mcp/create-mcp-server.js');
const { assertStaticRequiredScopes } = await import('../dist/core/mcp/required-scopes.js');

const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const baseData = {
  tools: [],
  toolHandler: async () => ({ content: [] }),
  agentBrief: 'B',
  agentPrompt: 'P',
};

const tool = (requiredScopes, metadataScopes) => ({
  name: 'scoped_tool',
  description: 'A scoped tool.',
  inputSchema: {
    $schema: JSON_SCHEMA,
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  ...(requiredScopes === undefined ? {} : { requiredScopes }),
  ...(metadataScopes === undefined ? {} : { _meta: { requiredScopes: metadataScopes } }),
});

async function connect(projectData, payload = { user: 'unscoped' }) {
  globalThis.__MCP_PROJECT_DATA__ = projectData;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer('http', {
    contextProvider: (_extra, context) => ({ ...context, payload }),
  });
  await server.connect(serverTransport);
  const client = new Client({ name: 'required-scopes-isolation-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client, server };
}

async function withConnection(projectData, fn) {
  const connected = await connect(projectData);
  try {
    await fn(connected.client);
  } finally {
    await connected.client.close();
    await connected.server.close();
    delete globalThis.__MCP_PROJECT_DATA__;
  }
}

assert.throws(() => assertStaticRequiredScopes({ tools: [tool(['calendar.read', 42])] }), /requiredScopes/);
assert.throws(
  () =>
    assertStaticRequiredScopes({
      customPrompts: [{ requiredScopes: 'calendar.read' }],
      customResources: [{ requiredScopes: ['invalid scope'] }],
      customResourceTemplates: [{ requiredScopes: ['calendar.read', 'calendar.read'] }],
    }),
  /requiredScopes/,
);
assert.throws(
  () => assertStaticRequiredScopes({ tools: [tool(['calendar.admin'], [])] }),
  /must declare the same scopes/,
);

let toolHandlerCalls = 0;
await withConnection(
  {
    ...baseData,
    tools: async () => [tool(undefined, ['calendar.read', 42])],
    toolHandler: async () => {
      toolHandlerCalls += 1;
      return { content: [{ type: 'text', text: 'must not run' }] };
    },
  },
  async (client) => {
    await assert.rejects(
      () => client.listTools(),
      (error) => error.code === -32603,
    );
    await assert.rejects(
      () => client.callTool({ name: 'scoped_tool', arguments: {} }),
      (error) => error.code === -32603,
    );
  },
);
assert.equal(toolHandlerCalls, 0, 'malformed dynamic tool scopes must fail before dispatch');

await withConnection(
  {
    ...baseData,
    customPrompts: async () => [
      {
        name: 'malformed_prompt',
        description: 'Malformed prompt.',
        arguments: [],
        content: 'must not be returned',
        requiredScopes: ['calendar.read', null],
      },
    ],
  },
  async (client) => {
    await assert.rejects(
      () => client.listPrompts(),
      (error) => error.code === -32603,
    );
    await assert.rejects(
      () => client.getPrompt({ name: 'malformed_prompt' }),
      (error) => error.code === -32603,
    );
  },
);

await withConnection(
  {
    ...baseData,
    customResources: async () => [
      {
        uri: 'scope://malformed',
        name: 'malformed-resource',
        description: 'Malformed resource.',
        mimeType: 'text/plain',
        content: 'must not be returned',
        requiredScopes: { scope: 'calendar.read' },
      },
    ],
  },
  async (client) => {
    await assert.rejects(
      () => client.listResources(),
      (error) => error.code === -32603,
    );
    await assert.rejects(
      () => client.readResource({ uri: 'scope://malformed' }),
      (error) => error.code === -32603,
    );
  },
);

let completionProviderCalls = 0;
await withConnection(
  {
    ...baseData,
    customResourceTemplates: async () => [
      {
        uriTemplate: 'scope://malformed/{id}',
        name: 'malformed-template',
        requiredScopes: ['calendar.read', 42],
      },
    ],
    completionProvider: async () => {
      completionProviderCalls += 1;
      return ['must-not-run'];
    },
  },
  async (client) => {
    await assert.rejects(
      () => client.listResourceTemplates(),
      (error) => error.code === -32603,
    );
    await assert.rejects(
      () =>
        client.request(
          {
            method: 'completion/complete',
            params: {
              ref: { type: 'ref/resource', uri: 'scope://malformed/{id}' },
              argument: { name: 'id', value: '' },
            },
          },
          ResultSchema,
        ),
      (error) => error.code === -32603,
    );
  },
);
assert.equal(completionProviderCalls, 0, 'malformed template scopes must fail before completion dispatch');

let promptProviderCalls = 0;
let promptContentCalls = 0;
let resourceProviderCalls = 0;
let resourceContentCalls = 0;
await withConnection(
  {
    ...baseData,
    customPrompts: async () => {
      promptProviderCalls += 1;
      return [
        {
          name: 'single_snapshot_prompt',
          description: 'Alternating prompt descriptor.',
          arguments: [],
          requiredScopes: promptProviderCalls % 2 === 1 ? [] : ['calendar.admin'],
          content: async () => {
            promptContentCalls += 1;
            return promptProviderCalls % 2 === 1 ? 'public prompt' : 'secret prompt';
          },
        },
      ];
    },
    customResources: async () => {
      resourceProviderCalls += 1;
      return [
        {
          uri: 'scope://single-snapshot',
          name: 'single-snapshot-resource',
          description: 'Alternating resource descriptor.',
          mimeType: 'text/plain',
          requiredScopes: resourceProviderCalls % 2 === 1 ? [] : ['calendar.admin'],
          content: async () => {
            resourceContentCalls += 1;
            return resourceProviderCalls % 2 === 1 ? 'public resource' : 'secret resource';
          },
        },
      ];
    },
  },
  async (client) => {
    const firstPrompt = await client.getPrompt({ name: 'single_snapshot_prompt' });
    assert.equal(firstPrompt.messages[0].content.text, 'public prompt');
    assert.equal(promptProviderCalls, 1);
    await assert.rejects(
      () => client.getPrompt({ name: 'single_snapshot_prompt' }),
      (error) => error.code === -32000 && error.data?.reason === 'insufficient_scope',
    );
    assert.equal(promptProviderCalls, 2, 'prompt provider must resolve exactly once per get request');
    assert.equal(promptContentCalls, 1, 'denied prompt content must not execute');

    const firstResource = await client.readResource({ uri: 'scope://single-snapshot' });
    assert.equal(firstResource.contents[0].text, 'public resource');
    assert.equal(resourceProviderCalls, 1);
    await assert.rejects(
      () => client.readResource({ uri: 'scope://single-snapshot' }),
      (error) => error.code === -32000 && error.data?.reason === 'insufficient_scope',
    );
    assert.equal(resourceProviderCalls, 2, 'resource provider must resolve exactly once per read request');
    assert.equal(resourceContentCalls, 1, 'denied resource content must not execute');
  },
);

await withConnection(baseData, async (client) => {
  const listed = await client.listPrompts();
  assert.equal(
    listed.prompts.some((prompt) => prompt.name === 'tool_prompt'),
    false,
  );
  for (const prompt of listed.prompts) {
    const value = await client.getPrompt({ name: prompt.name });
    assert.ok(value.messages.length > 0, `listed prompt ${prompt.name} must be gettable`);
  }
});

console.log('Required scopes fail closed and prompt/resource reads use one authorized descriptor snapshot.');
