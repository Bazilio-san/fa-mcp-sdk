/** Oversized read/write results preserve schema safety and expose safe retry semantics. */
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { appConfig } from '../dist/core/bootstrap/init-config.js';
import { createMcpServer } from '../dist/core/mcp/create-mcp-server.js';
import { serializedToolResultBytes } from '../dist/core/mcp/tool-limits.js';

const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const MAX_BYTES = 768;
const calls = { read: 0, write: 0, mirror: 0 };

const largeResultTool = (name, annotations) => ({
  name,
  description: `Return an oversized result from ${name}.`,
  annotations,
  inputSchema: {
    $schema: JSON_SCHEMA,
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    $schema: JSON_SCHEMA,
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
    additionalProperties: false,
  },
});

globalThis.__MCP_PROJECT_DATA__ = {
  agentBrief: 'B',
  agentPrompt: 'P',
  tools: [
    largeResultTool('read_large_result', { readOnlyHint: true }),
    largeResultTool('write_large_result', {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    }),
    largeResultTool('mirrored_result', { readOnlyHint: true }),
  ],
  toolHandler: async ({ name }) => {
    if (name === 'read_large_result') {
      calls.read += 1;
    } else if (name === 'write_large_result') {
      calls.write += 1;
    } else {
      calls.mirror += 1;
      return {
        content: [{ type: 'text', text: 'Human-readable explanation.' }],
        structuredContent: { value: 'small' },
      };
    }
    return { structuredContent: { value: 'x'.repeat(10_000) } };
  },
};

const previousMaxBytes = appConfig.mcp.limits.maxToolResultBytes;
const previousHideAnnotations = appConfig.mcp.tools.hideAnnotations;
appConfig.mcp.limits.maxToolResultBytes = MAX_BYTES;
appConfig.mcp.tools.hideAnnotations = true;

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createMcpServer('http');
await server.connect(serverTransport);
const client = new Client({ name: 'tool-result-limits-test', version: '1.0.0' }, { capabilities: {} });
await client.connect(clientTransport);

function assertLimitedResult(result, expected) {
  assert.equal(result.isError, true);
  assert.equal('structuredContent' in result, false, 'truncation sentinel must not violate outputSchema');
  assert.ok(serializedToolResultBytes(result) <= MAX_BYTES);

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.error.code, expected.code);
  assert.equal(payload.error.truncated, true);
  assert.equal(payload.error.retryable, expected.retryable);
  assert.equal(payload.error.sideEffectState, expected.sideEffectState);

  const metadata = result._meta?.['fa-mcp-sdk/result-limit'];
  assert.deepEqual(metadata, {
    code: expected.code,
    retryable: expected.retryable,
    sideEffectState: expected.sideEffectState,
  });
}

try {
  const listed = await client.listTools();
  assert.ok(
    listed.tools.every((tool) => tool.annotations === undefined),
    'public annotations must be hidden',
  );

  const readResult = await client.callTool({ name: 'read_large_result', arguments: {} });
  assertLimitedResult(readResult, {
    code: 'result_too_large',
    retryable: true,
    sideEffectState: 'not_applicable',
  });

  const writeResult = await client.callTool({ name: 'write_large_result', arguments: {} });
  assertLimitedResult(writeResult, {
    code: 'result_too_large_after_side_effect',
    retryable: false,
    sideEffectState: 'completed',
  });
  assert.match(writeResult.content[0].text, /do not retry/i);

  const mirroredResult = await client.callTool({ name: 'mirrored_result', arguments: {} });
  assert.deepEqual(JSON.parse(mirroredResult.content[0].text), { value: 'small' });
  assert.equal(mirroredResult.content[1].text, 'Human-readable explanation.');
  assert.deepEqual(mirroredResult.structuredContent, { value: 'small' });

  assert.deepEqual(calls, { read: 1, write: 1, mirror: 1 });
  console.log('Oversized read/write results expose bounded, schema-safe retry and side-effect semantics.');
} finally {
  appConfig.mcp.limits.maxToolResultBytes = previousMaxBytes;
  appConfig.mcp.tools.hideAnnotations = previousHideAnnotations;
  await client.close();
  await server.close();
  delete globalThis.__MCP_PROJECT_DATA__;
}
