import { initMcpServer } from '../../dist/core/init-mcp-server.js';

const tools = [
  {
    name: 'example_tool',
    description: 'Example tool for Streamable HTTP transport tests.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

const customResources = [
  {
    uri: 'test://resource',
    name: 'Test Resource',
    description: 'Resource for Streamable HTTP transport tests.',
    mimeType: 'text/plain',
    content: 'test resource content',
  },
];

await initMcpServer({
  tools,
  toolHandler: async ({ name, arguments: args }) => {
    if (name !== 'example_tool') {
      throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, query: args?.query ?? null }),
        },
      ],
    };
  },
  agentBrief: 'Test MCP server.',
  agentPrompt: 'You are a test MCP server.',
  customResources,
});
