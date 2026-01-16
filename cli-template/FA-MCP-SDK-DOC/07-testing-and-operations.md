# Testing, Transports, and Best Practices

## Testing Your MCP Server

### Test Structure

Create tests in your `tests/` directory:

**`tests/utils.ts`** - Test utilities:
```typescript
import { ITestResult, logResultToFile, formatResultAsMarkdown } from 'fa-mcp-sdk';

export interface ITestResult {
  fullId: string;
  toolName: string;
  description: string;
  parameters: unknown | null;
  timestamp: string;
  duration: number;
  status: 'pending' | 'passed' | 'failed' | 'skipped' | 'expected_failure';
  response: unknown | null;
  error: string | null;
}

// Log test results
await logResultToFile(testResult);

// Format as markdown
const markdown = formatResultAsMarkdown(testResult);
```

### Test Clients

Use the provided test clients to test your MCP server:

**STDIO Transport Testing:**

```typescript
// noinspection JSAnnotator

import { McpStdioClient } from 'fa-mcp-sdk';
import { spawn } from 'child_process';

const proc = spawn('node', ['dist/start.js', 'stdio'], {
   stdio: ['pipe', 'pipe', 'pipe'],
   env: { ...process.env, NODE_ENV: 'test' },
});

const client = new McpStdioClient(proc);

// Test tools
const result = await client.callTool('my_custom_tool', { query: 'test' });
console.log(result);

// Test prompts
const prompt = await client.getPrompt('agent_brief');
console.log(prompt);
```

**HTTP Transport Testing:**
```typescript
import { McpHttpClient } from 'fa-mcp-sdk';

const client = new McpHttpClient('http://localhost:3000');

// Test with authentication headers
const result = await client.callTool('my_custom_tool', { query: 'test' }, {
  'Authorization': 'Bearer your-jwt-token'
});
```

**SSE Transport Testing:**
```typescript
import { McpSseClient } from 'fa-mcp-sdk';

const client = new McpSseClient('http://localhost:3000');
const result = await client.callTool('my_custom_tool', { query: 'test' });
```

**Streamable HTTP Transport Testing (MCP 2025 Specification):**

```typescript
import { McpStreamableHttpClient } from 'fa-mcp-sdk';

// McpStreamableHttpClient - Test client for MCP Streamable HTTP transport
// Implements the new MCP 2025 streamable HTTP specification with NDJSON
// Supports long-lived connections, multiple requests/responses, and notifications

// Constructor:
const client = new McpStreamableHttpClient(baseUrl: string, options?: {
  endpointPath?: string;        // Default: '/mcp'
  headers?: Record<string, string>;
  requestTimeoutMs?: number;    // Default: 120000 (2 minutes)
});

// Example usage:
const client = new McpStreamableHttpClient('http://localhost:3000', {
  headers: { 'Authorization': 'Bearer your-token' },
  requestTimeoutMs: 60000,
});

// Initialize connection (required before other operations)
await client.initialize({
  protocolVersion: '2024-11-05',
  clientInfo: { name: 'test-client', version: '1.0.0' },
});

console.log('Server:', client.serverInfo);
console.log('Capabilities:', client.capabilities);

// Call tools
const toolResult = await client.callTool('my_custom_tool', { query: 'test' });
console.log('Tool result:', toolResult);

// Get prompts
const prompt = await client.getPrompt('agent_brief');

// List and read resources
const resources = await client.listResources();
const content = await client.readResource('custom-resource://data1');

// Subscribe to notifications
const unsubscribe = client.onNotification('notifications/tools/list_changed', (params) => {
  console.log('Tools changed:', params);
});

// Send custom RPC
const customResult = await client.sendRpc('custom/method', { foo: 'bar' });

// Close connection when done
await client.close();
```

**Key Features:**
- **NDJSON Streaming**: Newline-delimited JSON over HTTP for efficient communication
- **Bidirectional**: Supports both requests and server notifications
- **Persistent Connection**: Single HTTP connection for multiple operations
- **Timeout Handling**: Configurable request timeouts with automatic cleanup

**Available Methods:**

| Method                              | Description                       |
|-------------------------------------|-----------------------------------|
| `initialize(params)`                | Initialize MCP session            |
| `close()`                           | Close connection gracefully       |
| `callTool(name, args, headers?)`    | Execute an MCP tool               |
| `getPrompt(name, args?)`            | Retrieve a prompt                 |
| `listResources()`                   | List available resources          |
| `readResource(uri)`                 | Read resource content             |
| `listTools()`                       | List available tools              |
| `listPrompts()`                     | List available prompts            |
| `sendRpc(method, params, timeout?)` | Send custom JSON-RPC request      |
| `notify(method, params?)`           | Send notification (no response)   |
| `onNotification(method, handler)`   | Subscribe to server notifications |

### Test Categories and Recommendations

1. **Prompt Tests**:
   - Test that prompts are listed correctly
   - Test prompt content retrieval
   - Test dynamic prompt generation

2. **Resource Tests**:
   - Test resource listing
   - Test resource content reading
   - Test dynamic resource generation

3. **Tool Tests**:
   - Test tool listing
   - Test tool execution with valid parameters
   - Test error handling for invalid parameters
   - Test tool response formatting

4. **Transport Tests**:
   - Test all transport types your server supports
   - Test authentication (if enabled)
   - Test error responses

Example test implementation:
```typescript
// tests/mcp/test-tools.js
async function testMyCustomTool(client) {
  const name = 'Test my_custom_tool execution';
  try {
    const result = await client.callTool('my_custom_tool', { query: 'test input' });
    const success = result?.response?.includes('Processed');
    return success ?
      { name, passed: true, details: result } :
      { name, passed: false, details: result };
  } catch (error) {
    return { name, passed: false, details: { error: error.message } };
  }
}
```

---

## Transport Types

### STDIO Transport
- Use for CLI tools and local development
- Configure with `mcp.transportType: "stdio"`
- Lightweight, no HTTP overhead

### HTTP Transport
- Use for web-based integrations
- Configure with `mcp.transportType: "http"`
- Supports REST API, authentication, Swagger docs
- Requires `webServer` configuration

### Server-Sent Events (SSE)
- Real-time streaming over HTTP
- Good for long-running operations
- Maintains persistent connections

---

## Best Practices

### Project Organization
1. **Keep tools focused** - One responsibility per tool
2. **Use TypeScript** - Leverage type safety throughout
3. **Organize by feature** - Group related functionality
4. **Configure environments** - Use separate configs for dev/prod

### Tool Development
1. **Validate inputs** - Always check required parameters
2. **Use formatToolResult()** - Consistent response formatting
3. **Handle errors gracefully** - Use appropriate error classes
4. **Log operations** - Use the provided logger

### Testing
1. **Test all transports** - Ensure compatibility
2. **Include error cases** - Test failure scenarios
3. **Use provided clients** - Leverage built-in test utilities
4. **Document test cases** - Clear, descriptive test names

### Security
1. **Environment variables** - Never hardcode secrets
2. **Authentication** - Enable for production HTTP servers
3. **Input validation** - Validate all user inputs
4. **Error messages** - Don't leak sensitive information

---

This documentation provides everything needed to build, test, and deploy your own
MCP server using the FA-MCP-SDK framework.
