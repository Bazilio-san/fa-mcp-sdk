import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { appConfig } from '../dist/core/bootstrap/init-config.js';
import { createMcpServer } from '../dist/core/mcp/create-mcp-server.js';
import { getPromptsList } from '../dist/core/mcp/prompts.js';
import { getResourcesList } from '../dist/core/mcp/resources.js';
import { serializedToolResultBytes, truncateToolResponse } from '../dist/core/mcp/tool-limits.js';
import { assertToolSchemas, validateToolInput, validateToolOutput } from '../dist/core/mcp/validate-tool-args.js';
import {
  assertToolAliases,
  assertToolNames,
  resolveToolAlias,
  TOOL_NAME_RE,
} from '../dist/core/mcp/validate-tool-names.js';
import { isOriginAllowed } from '../dist/core/web/cors.js';
import { normalizeTransportHeaders } from '../dist/core/utils/utils.js';

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ❌  ${name}\n      ${error.stack ?? error.message}`);
  }
}

const canonicalTool = {
  name: 'get_item',
  description: 'Get one item.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
    additionalProperties: false,
  },
};

await test('tool-name validator implements the normative expression exactly', () => {
  assert.equal(TOOL_NAME_RE.source, '^[a-z][a-z0-9_]{1,63}$');
  assert.equal(TOOL_NAME_RE.test('a'), false);
  assert.equal(TOOL_NAME_RE.test('aa'), true);
  assert.equal(TOOL_NAME_RE.test(`a${'b'.repeat(63)}`), true);
  assert.equal(TOOL_NAME_RE.test(`a${'b'.repeat(64)}`), false);
  assert.throws(() => assertToolNames([{ ...canonicalTool, name: 'GetItem' }]));
});

await test('legacy aliases resolve to canonical tools but cannot shadow or target unknown tools', () => {
  const tools = [canonicalTool];
  const aliases = { GetItem: 'get_item' };
  assert.doesNotThrow(() => assertToolAliases(tools, aliases));
  assert.equal(resolveToolAlias('GetItem', tools, aliases), 'get_item');
  assert.equal(resolveToolAlias('get_item', tools, aliases), 'get_item');
  assert.throws(() => assertToolAliases(tools, { get_item: 'get_item' }), /shadows/);
  assert.throws(() => assertToolAliases(tools, { GetItem: 'missing_item' }), /unknown canonical/);
});

await test('invalid schemas fail closed and valid schemas reject bad input/output', () => {
  assert.throws(
    () => assertToolSchemas([{ ...canonicalTool, inputSchema: { type: 'not-a-json-schema-type' } }]),
    /not a valid JSON Schema/,
  );
  assert.equal(validateToolInput(canonicalTool, { id: '42' }).valid, true);
  assert.equal(validateToolInput(canonicalTool, { id: '42', extra: true }).valid, false);
  assert.equal(validateToolOutput(canonicalTool, { value: 42 }).valid, true);
  assert.equal(validateToolOutput(canonicalTool, { value: '42' }).valid, false);
});

await test('result ceiling covers non-text and mirrored fields in the complete serialized result', () => {
  const previous = appConfig.mcp.limits.maxToolResultBytes;
  appConfig.mcp.limits.maxToolResultBytes = 512;
  try {
    const oversized = {
      content: [{ type: 'image', data: 'x'.repeat(5_000), mimeType: 'image/png' }],
      structuredContent: { copy: 'x'.repeat(5_000) },
      _meta: { copy: 'x'.repeat(5_000) },
    };
    const limited = truncateToolResponse(oversized);
    assert.equal(limited.isError, true);
    assert.match(limited.content[0].text, /"truncated":true/);
    assert.ok(serializedToolResultBytes(limited) <= 512);
    assert.equal('structuredContent' in limited, false);
  } finally {
    appConfig.mcp.limits.maxToolResultBytes = previous;
  }
});

await test('CORS allow-list uses exact host/origin matching', () => {
  assert.equal(isOriginAllowed('http://localhost:9876', ['localhost']), true);
  assert.equal(isOriginAllowed('http://localhost.evil.test:9876', ['localhost']), false);
  assert.equal(isOriginAllowed('https://example.com', ['https://example.com']), true);
  assert.equal(isOriginAllowed('http://example.com', ['https://example.com']), false);
  assert.equal(isOriginAllowed('https://example.com.evil.test', ['example.com']), false);
  assert.equal(isOriginAllowed('https://example.com', ['*']), false);
});

await test('project transport context never receives raw credential headers', () => {
  assert.deepEqual(
    normalizeTransportHeaders({
      Authorization: 'Bearer secret',
      Cookie: 'session=secret',
      'Proxy-Authorization': 'Basic secret',
      'X-Api-Key': 'api-secret',
      'X-Service-Token': 'service-secret',
      'X-Jira-Token': 'jira-secret',
      'X-Custom-Auth': 'custom-secret',
      'X-Password': 'password-secret',
      'X-On-Behalf-Of-User': 'calendar-user',
      'X-Client-Version': '1.2.3',
    }),
    { 'x-on-behalf-of-user': 'calendar-user', 'x-client-version': '1.2.3' },
  );
});

await test('built-in prompt and resource reads are protected by default', async () => {
  globalThis.__MCP_PROJECT_DATA__ = {
    tools: [],
    toolHandler: async () => ({ content: [] }),
    agentBrief: 'Brief',
    agentPrompt: 'Prompt',
  };
  const prompts = await getPromptsList({ transport: 'http' });
  const resources = await getResourcesList({ transport: 'http' });
  assert.ok(prompts.prompts.length > 0);
  assert.ok(resources.resources.length > 0);
  assert.ok(prompts.prompts.every((prompt) => prompt.requireAuth === true));
  assert.ok(resources.resources.every((resource) => resource.requireAuth === true));
  const agentPrompt = prompts.prompts.find((prompt) => prompt.name === 'agent_prompt');
  assert.match(agentPrompt?.description ?? '', /operating instructions/i);
  assert.match(agentPrompt?.description ?? '', /authentication/i);
  assert.match(agentPrompt?.description ?? '', /active project data/i);
  assert.match(agentPrompt?.description ?? '', /text\/Markdown/i);
  const headerResource = resources.resources.find((resource) => resource.uri === 'use://http-headers');
  assert.match(headerResource?.description ?? '', /delegation or tool-specific behavior/i);
  assert.match(headerResource?.description ?? '', /authentication/i);
  assert.match(headerResource?.description ?? '', /active McpServerData\.usedHttpHeaders/i);
  assert.match(headerResource?.description ?? '', /JSON array/i);
});

await test('default read scope filters and protects built-in prompts/resources', async () => {
  const previousAuthEnabled = appConfig.webServer.auth.enabled;
  appConfig.webServer.auth.enabled = true;
  globalThis.__MCP_PROJECT_DATA__ = {
    tools: [],
    toolHandler: async () => ({ content: [] }),
    agentBrief: 'Scoped brief',
    agentPrompt: 'Scoped prompt',
    defaultReadScopes: ['calendar.read'],
    customPrompts: [
      {
        name: 'admin_prompt',
        description: 'Explicitly privileged prompt.',
        arguments: [],
        content: 'Admin only',
        requiredScopes: ['calendar.admin'],
      },
    ],
    customResources: [
      {
        uri: 'calendar://admin',
        name: 'calendar-admin',
        description: 'Explicitly privileged resource.',
        mimeType: 'text/plain',
        content: 'Admin only',
        requiredScopes: ['calendar.admin'],
      },
    ],
  };

  const declaredPrompts = (await getPromptsList({ transport: 'http' })).prompts;
  const declaredResources = (await getResourcesList({ transport: 'http' })).resources;
  assert.deepEqual(declaredPrompts.find((prompt) => prompt.name === 'agent_brief')?.requiredScopes, ['calendar.read']);
  assert.deepEqual(declaredResources.find((resource) => resource.uri === 'project://id')?.requiredScopes, [
    'calendar.read',
  ]);
  assert.deepEqual(declaredPrompts.find((prompt) => prompt.name === 'admin_prompt')?.requiredScopes, [
    'calendar.admin',
  ]);
  assert.deepEqual(declaredResources.find((resource) => resource.uri === 'calendar://admin')?.requiredScopes, [
    'calendar.admin',
  ]);

  const connect = async (payload, name) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer('http', {
      contextProvider: (_extra, context) => ({ ...context, payload }),
    });
    await server.connect(serverTransport);
    const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
    return { client, server };
  };

  try {
    const denied = await connect({ user: 'opaque-service' }, 'read-scope-denied');
    try {
      assert.deepEqual((await denied.client.listPrompts()).prompts, []);
      assert.deepEqual((await denied.client.listResources()).resources, []);
      await assert.rejects(
        () => denied.client.getPrompt({ name: 'agent_brief' }),
        (error) => error.code === -32000 && error.data?.reason === 'insufficient_scope',
      );
      await assert.rejects(
        () => denied.client.readResource({ uri: 'project://id' }),
        (error) => error.code === -32000 && error.data?.reason === 'insufficient_scope',
      );
    } finally {
      await denied.client.close();
      await denied.server.close();
    }

    const allowed = await connect({ user: 'calendar-reader', scope: 'calendar.read' }, 'read-scope-allowed');
    try {
      const { prompts } = await allowed.client.listPrompts();
      const { resources } = await allowed.client.listResources();
      assert.ok(prompts.some((prompt) => prompt.name === 'agent_brief'));
      assert.ok(resources.some((resource) => resource.uri === 'project://id'));
      assert.ok(!prompts.some((prompt) => prompt.name === 'admin_prompt'));
      assert.ok(!resources.some((resource) => resource.uri === 'calendar://admin'));
      assert.ok((await allowed.client.getPrompt({ name: 'agent_brief' })).messages.length > 0);
      assert.ok((await allowed.client.readResource({ uri: 'project://id' })).contents.length > 0);
    } finally {
      await allowed.client.close();
      await allowed.server.close();
    }
  } finally {
    appConfig.webServer.auth.enabled = previousAuthEnabled;
  }
});

await test('tools/call accepts an unlisted alias and promotes a JSON text result for outputSchema', async () => {
  let receivedName;
  globalThis.__MCP_PROJECT_DATA__ = {
    tools: [canonicalTool],
    toolAliases: { GetItem: 'get_item' },
    toolHandler: async ({ name }) => {
      receivedName = name;
      return { content: [{ type: 'text', text: '{"value":42}' }] };
    },
    agentBrief: '',
    agentPrompt: '',
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer('http');
  await server.connect(serverTransport);
  const client = new Client({ name: 'hardening-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      ['get_item'],
    );
    const result = await client.callTool({ name: 'GetItem', arguments: { id: '42' } });
    assert.equal(receivedName, 'get_item');
    assert.deepEqual(result.structuredContent, { value: 42 });
  } finally {
    await client.close();
    await server.close();
  }
});

await test('concurrency rejection never exposes the subject identity', async () => {
  const previousLimit = appConfig.mcp.rateLimit.maxConcurrentPerSubject;
  const secretSubject = 'employee.secret@example.test';
  let markStarted;
  let releaseFirst;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  globalThis.__MCP_PROJECT_DATA__ = {
    tools: [canonicalTool],
    toolHandler: async () => {
      markStarted();
      await gate;
      return { structuredContent: { value: 42 } };
    },
    agentBrief: '',
    agentPrompt: '',
  };
  appConfig.mcp.rateLimit.maxConcurrentPerSubject = 1;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer('http', {
    contextProvider: (_extra, context) => ({
      ...context,
      payload: { sub: secretSubject, user: 'employee_secret' },
    }),
  });
  await server.connect(serverTransport);
  const client = new Client({ name: 'concurrency-pii-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    const firstCall = client.callTool({ name: 'get_item', arguments: { id: 'first' } });
    await started;
    await assert.rejects(
      () => client.callTool({ name: 'get_item', arguments: { id: 'second' } }),
      (error) => {
        assert.equal(error.code, -32003);
        assert.doesNotMatch(JSON.stringify(error), /employee\.secret|employee_secret/i);
        return true;
      },
    );
    releaseFirst();
    await firstCall;
  } finally {
    releaseFirst();
    appConfig.mcp.rateLimit.maxConcurrentPerSubject = previousLimit;
    await client.close();
    await server.close();
  }
});

await test('timeout aborts project code and retains its concurrency slot until settlement', async () => {
  const previousLimit = appConfig.mcp.rateLimit.maxConcurrentPerSubject;
  const previousTimeout = appConfig.mcp.limits.toolTimeoutMs;
  let releaseFirst;
  let markStarted;
  let markAborted;
  let handlerCalls = 0;
  const firstStarted = new Promise((resolve) => {
    markStarted = resolve;
  });
  const firstAborted = new Promise((resolve) => {
    markAborted = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  globalThis.__MCP_PROJECT_DATA__ = {
    tools: [canonicalTool],
    toolHandler: async ({ signal }) => {
      handlerCalls += 1;
      if (handlerCalls === 1) {
        markStarted();
        signal.addEventListener('abort', markAborted, { once: true });
        await firstGate;
      }
      return { structuredContent: { value: 42 } };
    },
    agentBrief: '',
    agentPrompt: '',
  };
  appConfig.mcp.rateLimit.maxConcurrentPerSubject = 1;
  appConfig.mcp.limits.toolTimeoutMs = 25;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer('http');
  await server.connect(serverTransport);
  const client = new Client({ name: 'timeout-slot-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    const firstCall = client.callTool({ name: 'get_item', arguments: { id: 'first' } });
    await firstStarted;
    await assert.rejects(
      () => firstCall,
      (error) => error.code === -32004,
    );
    await firstAborted;

    await assert.rejects(
      () => client.callTool({ name: 'get_item', arguments: { id: 'overtake' } }),
      (error) => error.code === -32003,
    );
    assert.equal(handlerCalls, 1, 'the timed-out handler must retain the only concurrency slot');

    releaseFirst();
    await new Promise((resolve) => setImmediate(resolve));
    const finalCall = await client.callTool({ name: 'get_item', arguments: { id: 'after-settlement' } });
    assert.deepEqual(finalCall.structuredContent, { value: 42 });
    assert.equal(handlerCalls, 2);
  } finally {
    releaseFirst();
    appConfig.mcp.rateLimit.maxConcurrentPerSubject = previousLimit;
    appConfig.mcp.limits.toolTimeoutMs = previousTimeout;
    await client.close();
    await server.close();
  }
});

await test('production discovery hides scoped tools and direct calls fail before dispatch', async () => {
  let handlerCalls = 0;
  const previousAuthEnabled = appConfig.webServer.auth.enabled;
  const previousNodeEnv = process.env.NODE_ENV;
  appConfig.webServer.auth.enabled = true;
  process.env.NODE_ENV = 'production';
  globalThis.__MCP_PROJECT_DATA__ = {
    tools: [{ ...canonicalTool, _meta: { requiredScopes: ['calendar:read'] } }],
    toolHandler: async () => {
      handlerCalls += 1;
      return { structuredContent: { value: 42 } };
    },
    agentBrief: '',
    agentPrompt: '',
  };
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer('http');
    await server.connect(serverTransport);
    const client = new Client({ name: 'scope-test', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      assert.deepEqual(listed.tools, [], 'tools/list must hide tools unavailable to the current scope');
      await assert.rejects(
        () => client.callTool({ name: 'get_item', arguments: { id: '42' } }),
        (error) => error.code === -32000 && error.data?.reason === 'insufficient_scope',
      );
      assert.equal(handlerCalls, 0, 'scope denial must happen before project dispatch');
    } finally {
      await client.close();
      await server.close();
    }

    const [scopedClientTransport, scopedServerTransport] = InMemoryTransport.createLinkedPair();
    const scopedServer = createMcpServer('sse', {
      contextProvider: (_extra, context) => ({
        ...context,
        payload: { user: 'alice', scope: 'calendar:read' },
      }),
    });
    await scopedServer.connect(scopedServerTransport);
    const scopedClient = new Client({ name: 'scoped-discovery-test', version: '1.0.0' }, { capabilities: {} });
    await scopedClient.connect(scopedClientTransport);
    try {
      const listed = await scopedClient.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name),
        ['get_item'],
      );
      const result = await scopedClient.callTool({ name: 'get_item', arguments: { id: '42' } });
      assert.deepEqual(result.structuredContent, { value: 42 });
      assert.equal(handlerCalls, 1);
    } finally {
      await scopedClient.close();
      await scopedServer.close();
    }
  } finally {
    appConfig.webServer.auth.enabled = previousAuthEnabled;
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

await test('trusted stdio and auth-disabled development HTTP may use scoped tools', async () => {
  const previousAuthEnabled = appConfig.webServer.auth.enabled;
  let handlerCalls = 0;
  globalThis.__MCP_PROJECT_DATA__ = {
    tools: [{ ...canonicalTool, _meta: { requiredScopes: ['calendar:read'] } }],
    toolHandler: async () => {
      handlerCalls += 1;
      return { structuredContent: { value: 42 } };
    },
    agentBrief: '',
    agentPrompt: '',
  };

  const exercise = async (transport, clientName) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(transport);
    await server.connect(serverTransport);
    const client = new Client({ name: clientName, version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name),
        ['get_item'],
      );
      const result = await client.callTool({ name: 'get_item', arguments: { id: '42' } });
      assert.deepEqual(result.structuredContent, { value: 42 });
    } finally {
      await client.close();
      await server.close();
    }
  };

  try {
    appConfig.webServer.auth.enabled = false;
    await exercise('http', 'trusted-development-http');
    appConfig.webServer.auth.enabled = true;
    await exercise('stdio', 'trusted-stdio');
    assert.equal(handlerCalls, 2);
  } finally {
    appConfig.webServer.auth.enabled = previousAuthEnabled;
  }
});

await test('legacy HTTP+SSE transport is disabled by default', () => {
  assert.equal(appConfig.mcp.legacySse?.enabled, false);
});

await test('public SDK exports the registry used for project-specific metrics', async () => {
  const { getMetricsRegistry } = await import('../dist/core/index.js');
  const { initMetrics } = await import('../dist/core/metrics/metrics.js');
  const registry = getMetricsRegistry();
  const metrics = initMetrics();
  assert.equal(typeof registry.metrics, 'function');
  assert.equal(typeof registry.registerMetric, 'function');
  metrics.concurrentCalls.set(3);
  const exposition = await registry.metrics();
  assert.match(
    exposition,
    /# HELP mcp_concurrent_calls Aggregate number of in-flight MCP tools\/call invocations in this process\./,
  );
  assert.match(exposition, /^mcp_concurrent_calls 3$/m);
  assert.doesNotMatch(exposition, /mcp_concurrent_calls\{[^}]*subject=/);
  metrics.concurrentCalls.set(0);
});

if (failures > 0) {
  console.error(`\n${failures} compliance-hardening test(s) failed`);
  process.exit(1);
}
console.log('\nAll compliance-hardening tests passed!');
process.exit(0);
