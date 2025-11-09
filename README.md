# MCP Server Core

Core functionality for creating MCP (Model Context Protocol) servers with dependency injection.

## Overview

This package provides the foundational infrastructure for building MCP servers with configurable tools, prompts, resources, and HTTP endpoints. It uses a simple dependency injection pattern where all project-specific components are passed as data to the core initialization function.

## Usage

```typescript
import { initMcpServer, McpServerData } from '@mcp-staff/server-core';

const serverData: McpServerData = {
  // MCP components
  tools: [/* your tools */],
  toolHandler: async (params) => { /* your handler */ },

  // Prompts
  agentBrief: "Brief description",
  agentPrompt: "Detailed prompt",

  // HTTP components (optional)
  httpComponents: {
    apiRouter: router,
    swagger: swaggerConfig
  },

  // Assets (optional)
  assets: {
    favicon: svgContent
  }
};

await initMcpServer(serverData);
```

## Architecture

- **Zero Dependencies**: Core has no knowledge of project-specific code
- **Simple DI**: Uses global context for dependency injection
- **HTTP Optional**: Can run in STDIO or HTTP mode
- **Extensible**: Easy to add new extension points

## Extension Points

- **Tools**: Define MCP tools and their handlers
- **Prompts**: Agent system prompts and custom prompts
- **Resources**: File and data resources
- **HTTP API**: Express routers and Swagger documentation
- **Assets**: Icons and other static resources

## Configuration

All configuration comes from the parent project's config system. The core adapts to:

- Transport mode (STDIO/HTTP)
- Database connections
- Authentication settings
- Consul service registration
- Rate limiting

## Development

```bash
npm run build    # Build TypeScript
npm run dev      # Watch mode
npm run clean    # Clean dist/
```

This package is designed to be extracted into a standalone npm package for reuse across multiple MCP server projects.