# Testing and Operations

## Test Clients

### STDIO Transport

```typescript
import { McpStdioClient } from 'fa-mcp-sdk';
import { spawn } from 'child_process';

const proc = spawn('node', ['dist/start.js', 'stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'test' },
});

const client = new McpStdioClient(proc);
const result = await client.callTool('my_tool', { query: 'test' });
const prompt = await client.getPrompt('agent_brief');
```

### HTTP Transport

```typescript
import { McpHttpClient } from 'fa-mcp-sdk';

const client = new McpHttpClient('http://localhost:3000');
const result = await client.callTool('my_tool', { query: 'test' }, {
  'Authorization': 'Bearer token'
});
```

### SSE Transport

```typescript
import { McpSseClient } from 'fa-mcp-sdk';

const client = new McpSseClient('http://localhost:3000');
const result = await client.callTool('my_tool', { query: 'test' });
```

### Streamable HTTP (MCP 2025)

```typescript
import { McpStreamableHttpClient } from 'fa-mcp-sdk';

const client = new McpStreamableHttpClient('http://localhost:3000', {
  headers: { 'Authorization': 'Bearer token' },
  requestTimeoutMs: 60000,
});

await client.initialize({
  protocolVersion: '2024-11-05',
  clientInfo: { name: 'test-client', version: '1.0.0' },
});

const result = await client.callTool('my_tool', { query: 'test' });
const prompt = await client.getPrompt('agent_brief');
const resources = await client.listResources();
const content = await client.readResource('custom://data');

// Notifications
const unsub = client.onNotification('notifications/tools/list_changed', (p) => console.log(p));

await client.close();
```

**Methods:** `initialize`, `close`, `callTool`, `getPrompt`, `listResources`, `readResource`, `listTools`, `listPrompts`, `sendRpc`, `notify`, `onNotification`

## Transport Types

| Transport | Config | Use Case |
|-----------|--------|----------|
| STDIO | `mcp.transportType: "stdio"` | CLI, local dev |
| HTTP | `mcp.transportType: "http"` | Web integrations, REST API |
| SSE | HTTP transport | Long-running ops, streaming |

## Best Practices

### Project Organization
- One responsibility per tool
- Use TypeScript throughout
- Separate configs for dev/prod

### Tool Development
- Validate all inputs
- Use `formatToolResult()` for responses
- Use error classes for failures
- Log operations with `logger`

### Testing
- Test all transport types
- Include error cases
- Use provided test clients

### Security
- Environment variables for secrets
- Enable auth for production
- Validate all user inputs
- Don't leak sensitive info in errors
