# FA-MCP-SDK Documentation Index

## Overview

The FA-MCP-SDK is a comprehensive TypeScript framework for building Model Context
Protocol (MCP) servers. This is the documentation index - read the relevant
sections based on your task.

## Using with Claude Code

This project includes a specialized agent `.claude/agents/fa-mcp-sdk.md` for
Claude Code. The agent automatically reads relevant documentation sections and
follows SDK patterns.

### Example Prompts

**Creating tools:**
```
Use the fa-mcp-sdk subagent to add a tool "get_user" that fetches user data by ID from the database
```

**Adding REST API:**
```
Use the fa-mcp-sdk subagent to create REST endpoint POST /api/users for user registration with validation
```

**Setting up authentication:**
```
Use the fa-mcp-sdk subagent to configure JWT authentication with 1 hour token expiration
```

**Database integration:**
```
Use the fa-mcp-sdk subagent to add PostgreSQL integration and create a tool to query orders table
```

**Complex tasks:**
```
Use the fa-mcp-sdk subagent to create an MCP server for managing TODO lists with:
- tools: add_todo, list_todos, complete_todo, delete_todo
- PostgreSQL storage
- JWT authentication
- REST API for web client
```

The agent will read the appropriate documentation files and implement the
functionality following SDK conventions.

## Quick Start

```bash
npm install fa-mcp-sdk
```

## Documentation Structure

| File                                                       | Content | Read When |
|------------------------------------------------------------|---------|-----------|
| [01-getting-started.md](01-getting-started.md)             | Installation, project structure, `initMcpServer()`, core types (`McpServerData`, `IPromptData`, `IResourceData`) | Starting a new project, understanding project structure |
| [02-1-tools-and-api.md](02-1-tools-and-api.md)             | Tool definitions, `toolHandler`, HTTP headers, REST API with tsoa decorators, OpenAPI/Swagger auto-generation | Creating MCP tools, adding REST endpoints |
| [02-2-prompts-and-resources.md](02-2-prompts-and-resources.md) | Standard prompts (agent-brief, agent-prompt), custom prompts, standard resources, custom resources, `requireAuth` | Configuring prompts and resources |
| [03-configuration.md](03-configuration.md)                 | `appConfig`, YAML configuration, cache management, database integration (PostgreSQL) | Configuring the server, using cache or database |
| [04-authentication.md](04-authentication.md)               | Multi-auth system, JWT tokens, Basic auth, server tokens, custom validators, `createAuthMW()` | Setting up authentication |
| [05-ad-authorization.md](05-ad-authorization.md)           | AD group-based authorization examples: HTTP level, all tools, per-tool | Implementing AD group restrictions |
| [06-utilities.md](06-utilities.md)                         | Error handling, utility functions, logging, events, Consul integration, graceful shutdown | Error handling, logging, service discovery |
| [07-testing-and-operations.md](07-testing-and-operations.md) | Test clients (STDIO, HTTP, SSE), transport types, best practices | Testing, deployment, operations |

## Common Tasks Quick Reference

### Create a new MCP server
Read: `01-getting-started.md` → `02-1-tools-and-api.md`

### Add MCP tools
Read: `02-1-tools-and-api.md` (Tool Development section)

### Add REST API endpoints
Read: `02-1-tools-and-api.md` (REST API Endpoints section)
- Use tsoa decorators (`@Route`, `@Get`, `@Post`, `@Tags`)
- Swagger generates automatically if `swagger/openapi.yaml` doesn't exist

### Configure prompts
Read: `02-2-prompts-and-resources.md`
- Standard: `agent-brief.ts` (short description), `agent-prompt.ts` (full instructions)
- Custom: add to `customPrompts` array in `src/prompts/custom-prompts.ts`
- Use `requireAuth: true` to protect prompts

### Configure resources
Read: `02-2-prompts-and-resources.md`
- Standard: `project://id`, `project://name`, `doc://readme`, `required://http-headers`
- Custom: add to `customResources` array in `src/custom-resources.ts`
- Use `requireAuth: true` to protect resources

### Configure authentication
Read: `04-authentication.md`
- Enable in `config/default.yaml` under `webServer.auth`
- Options: `permanentServerTokens`, `jwtToken`, `basic`, custom validator

### Add AD group authorization
Read: `05-ad-authorization.md`
- HTTP level (block at entry)
- Tool level (restrict all or specific tools)

### Use database
Read: `03-configuration.md` (Database Integration section)
- Set `db.postgres.dbs.main.host` in config
- Use `queryMAIN()`, `execMAIN()`, `oneRowMAIN()`

### Use caching
Read: `03-configuration.md` (Cache Management section)
- `getCache()` → `cache.get()`, `cache.set()`, `cache.getOrSet()`

### Write tests
Read: `07-testing-and-operations.md`
- Use `McpHttpClient`, `McpStdioClient`, `McpSseClient`
- Use `getAuthHeadersForTests()` for auth headers

## Key Exports from fa-mcp-sdk

```typescript
// Initialization
import { initMcpServer, McpServerData } from 'fa-mcp-sdk';

// Configuration
import { appConfig } from 'fa-mcp-sdk';

// Authentication
import { createAuthMW, checkJwtToken, generateToken, getAuthHeadersForTests } from 'fa-mcp-sdk';

// Tools
import { formatToolResult, ToolExecutionError } from 'fa-mcp-sdk';

// Database
import { queryMAIN, execMAIN, oneRowMAIN, checkMainDB } from 'fa-mcp-sdk';

// Cache
import { getCache } from 'fa-mcp-sdk';

// Logging
import { logger, fileLogger } from 'fa-mcp-sdk';

// Utilities
import { trim, ppj, toError, toStr } from 'fa-mcp-sdk';

// Test clients
import { McpHttpClient, McpStdioClient, McpSseClient } from 'fa-mcp-sdk';

// AD Groups
import { initADGroupChecker } from 'fa-mcp-sdk';
```

## Project Structure

```
my-mcp-server/
├── config/
│   ├── default.yaml             # Base configuration
│   ├── development.yaml         # Development overrides
│   ├── local.yaml               # Local secrets (gitignored)
│   └── production.yaml          # Production overrides
├── src/
│   ├── _types_/
│   │   ├── common.d.ts          # Common type declarations
│   │   └── custom-config.ts     # Custom config interface
│   ├── api/
│   │   └── router.ts            # REST endpoints with tsoa decorators
│   ├── asset/
│   │   └── logo.svg             # Static assets
│   ├── prompts/
│   │   ├── agent-brief.ts       # Short agent description
│   │   ├── agent-prompt.ts      # Full agent system prompt
│   │   └── custom-prompts.ts    # Additional prompts
│   ├── tools/
│   │   ├── handle-tool-call.ts  # Tool execution logic
│   │   └── tools.ts             # Tool definitions
│   ├── custom-resources.ts      # Custom MCP resources
│   └── start.ts                 # Entry point
├── swagger/
│   └── openapi.yaml             # Auto-generated (gitignored)
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

export const tools: Tool[] = [
  {
    name: 'hello',
    description: 'Say hello',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name to greet' }
      },
      required: ['name']
    }
  }
];
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
