# FA-MCP-SDK Documentation Index

TypeScript framework for building MCP servers.

## Quick Start

```bash
npm install fa-mcp-sdk
```

## Documentation Structure

| File | Content | Read When |
|------|---------|-----------|
| [01-getting-started](01-getting-started.md) | `initMcpServer()`, `McpServerData`, `IPromptData`, `IResourceData`, `AppConfig` | Starting new project |
| [02-1-tools-and-api](02-1-tools-and-api.md) | Tool definitions, `toolHandler`, REST API with tsoa, OpenAPI/Swagger | Creating tools, REST endpoints |
| [02-2-prompts-and-resources](02-2-prompts-and-resources.md) | Standard/custom prompts, resources, `requireAuth` | Configuring prompts/resources |
| [03-configuration](03-configuration.md) | `appConfig`, YAML config, cache, PostgreSQL | Server configuration, DB |
| [04-authentication](04-authentication.md) | JWT, Basic auth, server tokens, `createAuthMW()`, Token Generator | Authentication setup |
| [05-ad-authorization](05-ad-authorization.md) | AD group authorization at HTTP/tool levels | AD group restrictions |
| [06-utilities](06-utilities.md) | `ServerError`, `normalizeHeaders`, logging, Consul, graceful shutdown | Error handling, utilities |
| [07-testing-and-operations](07-testing-and-operations.md) | Test clients (STDIO, HTTP, SSE, Streamable HTTP) | Testing, deployment |

## Key Exports

```typescript
// Core
import { initMcpServer, McpServerData, appConfig, getProjectData, getSafeAppConfig, ROOT_PROJECT_DIR } from 'fa-mcp-sdk';

// Auth
import { createAuthMW, generateToken, getAuthHeadersForTests, TTokenType, generateTokenApp } from 'fa-mcp-sdk';

// Tools & Errors
import { formatToolResult, ToolExecutionError, ServerError, BaseMcpError, ValidationError, getTools } from 'fa-mcp-sdk';

// Database & Cache
import { queryMAIN, execMAIN, oneRowMAIN, checkMainDB, getCache } from 'fa-mcp-sdk';

// Utilities
import { logger, fileLogger, trim, ppj, toError, toStr, normalizeHeaders } from 'fa-mcp-sdk';

// Test Clients
import { McpHttpClient, McpStdioClient, McpSseClient, McpStreamableHttpClient } from 'fa-mcp-sdk';

// AD Groups
import { initADGroupChecker, IADConfig, IDcConfig } from 'fa-mcp-sdk';

// OpenAPI
import { configureOpenAPI, OpenAPISpecResponse, SwaggerUIConfig } from 'fa-mcp-sdk';
```

## Project Structure

```
my-mcp-server/
├── config/
│   ├── default.yaml        # Base configuration
│   ├── development.yaml    # Dev overrides
│   ├── local.yaml          # Local secrets (gitignored)
│   └── production.yaml     # Prod overrides
├── src/
│   ├── _types_/
│   │   └── custom-config.ts    # Custom config interface
│   ├── api/
│   │   └── router.ts           # REST endpoints (tsoa)
│   ├── prompts/
│   │   ├── agent-brief.ts      # Short agent description
│   │   ├── agent-prompt.ts     # Full agent prompt
│   │   └── custom-prompts.ts   # Additional prompts
│   ├── tools/
│   │   ├── handle-tool-call.ts # Tool execution
│   │   └── tools.ts            # Tool definitions
│   ├── custom-resources.ts     # Custom MCP resources
│   └── start.ts                # Entry point
└── tests/
```

## Minimal Example

**`src/start.ts`:**
```typescript
import { initMcpServer, McpServerData } from 'fa-mcp-sdk';
import { tools } from './tools/tools.js';
import { handleToolCall } from './tools/handle-tool-call.js';

const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  agentBrief: 'My MCP Server',
  agentPrompt: 'You are a helpful assistant.',
};

await initMcpServer(serverData);
```

**`src/tools/tools.ts`:**
```typescript
import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [{
  name: 'hello',
  description: 'Say hello',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Name to greet' } },
    required: ['name']
  }
}];
```

**`src/tools/handle-tool-call.ts`:**
```typescript
import { formatToolResult, ToolExecutionError } from 'fa-mcp-sdk';

export const handleToolCall = async (params: { name: string; arguments?: any }): Promise<any> => {
  const { name, arguments: args } = params;
  switch (name) {
    case 'hello':
      return formatToolResult({ message: `Hello, ${args.name}!` });
    default:
      throw new ToolExecutionError(name, `Unknown tool: ${name}`);
  }
};
```
