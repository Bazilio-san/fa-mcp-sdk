# fa-mcp-sdk

Production-ready core framework for building MCP (Model Context Protocol) servers with comprehensive 
infrastructure support.

## Overview

This framework provides complete infrastructure for building enterprise-grade MCP servers with support for:

- **Dual Transport**: STDIO (Claude Desktop) and HTTP/SSE (web clients)
- **Database Integration**: PostgreSQL with pgvector for vector operations
- **Service Discovery**: Consul integration for microservices
- **Authentication**: Token-based security with configurable endpoints
- **Rate Limiting**: Configurable rate limiting for all endpoints
- **API Documentation**: Automatic Swagger generation
- **Production Logging**: Structured logging with data masking
- **Configuration Management**: YAML-based with environment overrides

The framework uses dependency injection to keep the core completely agnostic of project-specific implementations.

## Project Structure

```
fa-mcp-sdk/
├── src/core/           # Core framework (published to npm)
│   ├── bootstrap/      # Configuration and startup
│   ├── mcp/            # MCP protocol implementation
│   ├── web/            # HTTP server and endpoints
│   ├── db/             # PostgreSQL integration
│   ├── cache/          # Caching system with node-cache wrapper
│   ├── consul/         # Service discovery
│   ├── token/          # Authentication
│   ├── errors/         # Error handling
│   ├── utils/          # Utilities
│   └── index.ts        # Public API
│
└── src/template/       # Reference implementation
    ├── tools/          # Example MCP tools
    ├── prompts/        # Agent prompts
    ├── api/            # Custom HTTP endpoints
    └── start.ts        # Entry point
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure

Create configuration files in `config/`:

See [config/default.yaml](config/default.yaml) for all available options.
See [config/_local.yaml](config/_local.yaml) for template of local configuration.


### 3. Basic Usage

```typescript
import { initMcpServer, isMainModule, McpServerData } from '../core/index.js';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function startProject(): Promise<void> {
  // Read favicon from assets
  const faviconPath = join(process.cwd(), 'src/template/asset/favicon.svg');
  let favicon: string;

  try {
    favicon = readFileSync(faviconPath, 'utf-8');
  } catch (_error) {
    // Fallback if favicon not found
    favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
<rect width="16" height="16" fill="#007ACC"/>
</svg>`;
  }

  // Assemble all data to pass to the core
  const serverData: McpServerData = {
    // Required: MCP components
    tools: [
      {
        name: 'example_tool',
        description: 'Example tool',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Query parameter' }
          }
        }
      }
    ],
    toolHandler: async (params) => {
      const { name, arguments: args } = params;
      if (name === 'example_tool') {
        return `Result: ${args.query}`;
      }
      throw new Error(`Unknown tool: ${name}`);
    },

    // Required: Agent identification
    agentBrief: "My MCP Server - Brief description for agent selection",
    agentPrompt: "Detailed system prompt for the agent",

    // Optional: Custom prompts and resources
    customPrompts: [],
    customResources: [],

    // Optional: HTTP components
    httpComponents: {
      apiRouter, // Express router for custom endpoints
      endpointsOn404, // 404 handler
      swagger: {
        swaggerSpecs: swaggerSpecs, // OpenAPI specs
        swaggerUi: swaggerUi, // Swagger UI configuration
      },
    },

    // Optional: Assets
    assets: { favicon },

    // Optional: Function to get Consul UI address
    getConsulUIAddress: (serviceId: string) =>
      `https://consul.my.ui/ui/dc-dev/services/${serviceId}/instances`,
  };

  // Start MCP server with assembled data
  await initMcpServer(serverData);
}

// Auto-start if this file is run directly
if (isMainModule(import.meta.url)) {
  startProject().catch(error => {
    console.error('Failed to start project:', error);
    process.exit(1);
  });
}
```

For NPM package usage:

```typescript
import { initMcpServer, McpServerData } from '@mcp-staff/server-core';
// Rest of the code is similar, but with package imports
```

## Transport Modes

### STDIO Mode (Claude Desktop)

For integration with Claude Desktop:

```bash
# Set transport in config
mcp.transportType: stdio

# Or via command line
npm start stdio
```

Communication happens via stdin/stdout using JSON-RPC protocol.

### HTTP Mode (Web Integration)

For web applications and API access:

```bash
# Default mode
npm start
```

Provides endpoints:

- `GET /` - Home page with server info
- `GET /health` - Health check
- `GET /sse` - Server-Sent Events for MCP communication
- `POST /mcp` - Direct MCP JSON-RPC endpoint
- `GET /docs` - Swagger API documentation
- `/api/*` - Custom API endpoints

## Core Features

### Database Integration

Built-in PostgreSQL support with connection pooling:

All available functions see [src/core/db/pg-db.ts](src/core/db/pg-db.ts)



## Template Project

The `src/template/` directory contains a complete reference implementation:

### Running the Template

```bash
# Development mode (watch for changes)
npm run template:dev

# Production mode
npm run template:start

# STDIO mode for Claude Desktop
npm run template:stdio
```

### Template Structure

- **Tools**: `src/template/tools/tools.ts` - Define your MCP tools
- **Handlers**: `src/template/tools/handle-tool-call.ts` - Implement tool logic
- **Prompts**: `src/template/prompts/` - Agent system prompts
- **API**: `src/template/api/router.ts` - Custom HTTP endpoints
- **Config**: `config/` - Configuration files

## Configuration

### Environment Variables

Set via `config/custom-environment-variables.yaml`:

```bash
DB_HOST=localhost # To exclude the use of the database, you need to set host = ''
DB_NAME=mydb
DB_USER=user
DB_PASSWORD=password
MCP_TRANSPORT_TYPE=http
WS_PORT=9876
WS_AUTH_ENABLED=false
```

### Configuration Priority

1. Environment variables
2. Environment-specific YAML (`development.yaml`, `production.yaml`)
3. `config/default.yaml`
4. Package.json metadata

## Development

### Building

```bash
npm run build     # Build TypeScript
npm run clean     # Clean dist/
npm run cb        # Clean + build
```

### Linting

```bash
npm run lint      # Check code style
npm run lint:fix  # Fix automatically
```

### Type Checking

```bash
npm run typecheck
```

### Testing

The framework includes built-in testing utilities for MCP servers:

```javascript
import { McpSseClient } from 'fa-mcp-sdk';

// For npm package usage - prevents unhandledRejection
const client = McpSseClient.createWithErrorHandler('http://localhost:3000');

try {
  const response = await client.callTool('tool_name', { param: 'value' });
  console.log('Success:', response);
} catch (error) {
  console.log('Error:', error.message); // Properly caught
} finally {
  await client.close();
}
```

**Note**: When using `fa-mcp-sdk` as an npm package, use `McpSseClient.createWithErrorHandler()` to prevent `unhandledRejection` errors that can occur with SSE-based error handling.

## API Reference

### McpServerData Interface

See: [src/core/_types_/types.ts](src/core/_types_/types.ts)

### Core Exports

See: [src/core/index.ts](src/core/index.ts)

## Requirements

- **Node.js**: >= 18.0.0
- **TypeScript**: >= 5.0.0
- **PostgreSQL**: >= 12 (optional)
- **Consul**: Any version (optional)

## License

MIT
