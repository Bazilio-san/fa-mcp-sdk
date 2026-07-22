import { initMcpServer } from '../../dist/core/init-mcp-server.js';

let readinessCalls = 0;

await initMcpServer({
  tools: [],
  toolHandler: async () => ({ content: [] }),
  agentBrief: 'Readiness test server.',
  agentPrompt: 'Readiness test server.',
  customResources: [],
  readinessChecks: {
    slow_dependency: async () => {
      readinessCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return readinessCalls === 1;
    },
  },
});
