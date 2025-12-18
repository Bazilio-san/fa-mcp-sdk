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
