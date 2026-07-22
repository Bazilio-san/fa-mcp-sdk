/**
 * Phase 5 / WI-5 — opt-in `completions` capability (standard §8.2, MAY).
 *
 * Enabled via NODE_CONFIG (mcp.completions.enabled=true) for this process. The capability is
 * advertised only when a completionProvider is also supplied; completion/complete then returns
 * the provider's values capped at 100 with a correct `hasMore`. Without a provider the capability
 * is absent and completion/complete returns -32601.
 *
 * Uses the SDK in-memory transport — no HTTP spawn.
 */
process.env.NODE_CONFIG = JSON.stringify({
  mcp: { completions: { enabled: true }, resources: { templatesEnabled: true } },
});

import assert from 'node:assert/strict';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ResultSchema } from '@modelcontextprotocol/sdk/types.js';

const { createMcpServer } = await import('../dist/core/mcp/create-mcp-server.js');
const { appConfig } = await import('../dist/core/bootstrap/init-config.js');

async function connect(projectData, payload) {
  globalThis.__MCP_PROJECT_DATA__ = projectData;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(
    'http',
    payload === undefined ? undefined : { contextProvider: (_extra, context) => ({ ...context, payload }) },
  );
  await server.connect(serverTransport);
  const client = new Client({ name: 'completions-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { server, client };
}

let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ❌  ${name}\n      ${err.message}`);
  }
};

const baseData = { tools: [], toolHandler: async () => ({ content: [] }), agentBrief: 'B', agentPrompt: 'P' };

// --- default/explicit read scopes cover templates and completion references ---
{
  const previousAuthEnabled = appConfig.webServer.auth.enabled;
  appConfig.webServer.auth.enabled = true;
  let providerCalls = 0;
  const projectData = {
    ...baseData,
    defaultReadScopes: ['calendar.read'],
    customResourceTemplates: [
      { uriTemplate: 'calendar://events/{id}', name: 'event' },
      { uriTemplate: 'calendar://admin/{id}', name: 'admin-event', requiredScopes: ['calendar.admin'] },
      { uriTemplate: 'calendar://public/{id}', name: 'public-event', requiredScopes: [] },
    ],
    completionProvider: () => {
      providerCalls += 1;
      return ['candidate'];
    },
  };
  try {
    const denied = await connect(projectData, { user: 'unscoped' });
    await test('resource template discovery applies default and explicit read scopes', async () => {
      const listed = await denied.client.listResourceTemplates();
      assert.deepEqual(
        listed.resourceTemplates.map((template) => template.name),
        ['public-event'],
      );
      await assert.rejects(
        () =>
          denied.client.request(
            {
              method: 'completion/complete',
              params: {
                ref: { type: 'ref/prompt', name: 'agent_prompt' },
                argument: { name: 'x', value: '' },
              },
            },
            ResultSchema,
          ),
        (error) => error.code === -32000 && error.data?.reason === 'insufficient_scope',
      );
      assert.equal(providerCalls, 0, 'scope denial must happen before the completion provider');
    });
    await denied.client.close();
    await denied.server.close();

    const reader = await connect(projectData, { user: 'reader', scope: 'calendar.read' });
    await test('completion refs enforce target scopes before provider dispatch', async () => {
      const listed = await reader.client.listResourceTemplates();
      assert.deepEqual(
        listed.resourceTemplates.map((template) => template.name),
        ['event', 'public-event'],
      );
      const allowed = await reader.client.request(
        {
          method: 'completion/complete',
          params: {
            ref: { type: 'ref/resource', uri: 'calendar://events/{id}' },
            argument: { name: 'id', value: '' },
          },
        },
        ResultSchema,
      );
      assert.deepEqual(allowed.completion.values, ['candidate']);
      await assert.rejects(
        () =>
          reader.client.request(
            {
              method: 'completion/complete',
              params: {
                ref: { type: 'ref/resource', uri: 'calendar://admin/{id}' },
                argument: { name: 'id', value: '' },
              },
            },
            ResultSchema,
          ),
        (error) => error.code === -32000 && error.data?.reason === 'insufficient_scope',
      );
      assert.equal(providerCalls, 1);
    });
    await reader.client.close();
    await reader.server.close();
  } finally {
    appConfig.webServer.auth.enabled = previousAuthEnabled;
  }
}

// --- enabled + provider ---
{
  const provider = ({ argument }) => ['alpha', 'beta', 'gamma'].filter((v) => v.startsWith(argument.value));
  const { server, client } = await connect({ ...baseData, completionProvider: provider });
  const caps = client.getServerCapabilities();

  await test('completions advertised when enabled + provider present', () => {
    assert.ok(caps.completions);
  });
  await test('completion/complete returns the filtered provider values', async () => {
    const res = await client.request(
      {
        method: 'completion/complete',
        params: { ref: { type: 'ref/prompt', name: 'agent_prompt' }, argument: { name: 'x', value: 'a' } },
      },
      ResultSchema,
    );
    assert.deepEqual(res.completion.values, ['alpha']);
    assert.equal(res.completion.hasMore, false);
  });

  await client.close();
  await server.close();
}

// --- enabled + provider returning > 100 values (cap + hasMore) ---
{
  const many = Array.from({ length: 150 }, (_v, i) => `item-${i}`);
  const { server, client } = await connect({ ...baseData, completionProvider: () => many });

  await test('completion values are capped at 100 with hasMore=true', async () => {
    const res = await client.request(
      {
        method: 'completion/complete',
        params: { ref: { type: 'ref/prompt', name: 'agent_prompt' }, argument: { name: 'x', value: '' } },
      },
      ResultSchema,
    );
    assert.equal(res.completion.values.length, 100);
    assert.equal(res.completion.total, 150);
    assert.equal(res.completion.hasMore, true);
  });

  await client.close();
  await server.close();
}

// --- enabled but NO provider → capability absent, -32601 ---
{
  const { server, client } = await connect({ ...baseData });
  const caps = client.getServerCapabilities();

  await test('completions NOT advertised without a provider', () => {
    assert.equal(caps.completions, undefined);
  });
  await test('completion/complete → -32601 without a provider', async () => {
    await assert.rejects(
      () =>
        client.request(
          {
            method: 'completion/complete',
            params: { ref: { type: 'ref/prompt', name: 'agent_prompt' }, argument: { name: 'x', value: 'a' } },
          },
          ResultSchema,
        ),
      (err) => err.code === -32601,
    );
  });

  await client.close();
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll completions tests passed!');
