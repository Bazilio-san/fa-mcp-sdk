import { ProtocolError } from '@modelcontextprotocol/server';
import { Socket } from 'node:net';

// Servers accept local test connections but may never initiate network connections.
Socket.prototype.connect = function () {
  throw new Error('Outbound network connections are disabled in conformance workers');
};

const { formatInputRequired } = await import('../../dist/core/mcp/v2/mrtr.js');
const question = (key) => ({
  [key]: {
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: 'Confirm?',
      requestedSchema: { type: 'object', properties: {} },
    },
  },
});
let calls = 0;
globalThis.__MCP_PROJECT_DATA__ = {
  agentBrief: '',
  agentPrompt: '',
  usedHttpHeaders: [
    { name: 'Authorization', description: 'Synthetic test header' },
    { name: 'x-project-secret', description: 'Synthetic private header', isOptional: true, isSecret: true },
  ],
  customAuthValidator: async (req) =>
    req.headers['x-test-subject']
      ? { success: true, payload: { sub: req.headers['x-test-subject'] } }
      : { success: false },
  tools: [
    'greet',
    'slow_compute',
    'failing_job',
    'protocol_error_job',
    'confirm_delete',
    'slow',
    'approval',
    'repeat',
    'multi',
    'two',
    'error',
    'tool_error',
    'echo',
    'echo_input',
    'stats',
  ].map((name) => ({
    name,
    inputSchema: { type: 'object' },
    ...(['greet', 'echo', 'echo_input', 'stats'].includes(name) ? {} : { execution: { taskSupport: 'optional' } }),
  })),
  customResources: [
    { uri: 'test://object', name: 'object', content: { value: 1 } },
    { uri: 'test://array', name: 'array', content: [1, 2] },
    { uri: 'test://string', name: 'string', content: 'hello' },
    { uri: 'test://binary', name: 'binary', content: { blob: Buffer.from('hello') } },
    { uri: 'test://invalid', name: 'invalid', content: () => ({ value: 1n }) },
  ],
  toolHandler: async (p) => {
    if (p.name === 'stats') {
      return { content: [{ type: 'text', text: String(calls) }] };
    }
    calls++;
    if (p.name === 'greet') {
      return { content: [{ type: 'text', text: `Hello, ${p.arguments.name}!` }] };
    }
    if (p.name === 'slow_compute') {
      await new Promise((r) => setTimeout(r, Number(p.arguments.seconds ?? 1) * 1000));
      return { content: [{ type: 'text', text: 'Computed' }] };
    }
    if (p.name === 'failing_job') {
      return { content: [{ type: 'text', text: 'Synthetic tool error' }], isError: true };
    }
    if (p.name === 'protocol_error_job') {
      throw new ProtocolError(-32603, 'Synthetic protocol error');
    }
    if (p.name === 'confirm_delete' && !p.inputResponses) {
      return formatInputRequired({ inputRequests: question('confirm') });
    }
    if (p.name === 'error') {
      throw new ProtocolError(-32602, 'Safe error', { field: 'query', stack: 'SECRET' });
    }
    if (p.name === 'slow') {
      await new Promise((r) => setTimeout(r, 150));
      p.sendProgress?.({ progress: 1 });
      p.log?.('info', 'background-message');
    }
    if (p.name === 'multi') {
      const round = p.requestStatePayload?.round ?? 0;
      if (round < 2) {
        return formatInputRequired({ inputRequests: question(`round-${round}`), state: { round: round + 1 } });
      }
    }
    if (p.name === 'two' && !p.inputResponses) {
      return formatInputRequired({ inputRequests: { ...question('first'), ...question('second') } });
    }
    if (['approval', 'repeat', 'echo_input'].includes(p.name)) {
      if (!p.inputResponses || p.name === 'repeat') {
        return formatInputRequired({ inputRequests: question('approve'), state: { round: 1 } });
      }
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ args: p.arguments, state: p.requestStatePayload }) }],
      ...(p.name === 'tool_error' ? { isError: true } : {}),
    };
  },
};
if (process.argv[2] === 'stdio') {
  const { startDualEraStdioServer } = await import('../../dist/core/mcp/v2/stdio.js');
  const { createMcpServer } = await import('../../dist/core/mcp/create-mcp-server.js');
  await startDualEraStdioServer(() => createMcpServer('stdio'));
} else {
  const { startHttpServer } = await import('../../dist/core/web/server-http.js');
  await startHttpServer();
}
