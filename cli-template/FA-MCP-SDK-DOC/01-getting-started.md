# Getting Started with FA-MCP-SDK

## Overview

The FA-MCP-SDK is a comprehensive TypeScript framework for building Model Context
Protocol (MCP) servers. This documentation covers how to use the SDK
to create your own MCP server project.

## Installation

```bash
npm install fa-mcp-sdk
```

## Project Structure

When creating a new MCP server, your project structure should follow this pattern:

```
my-mcp-server/
├── config/                      # Environment configurations
│   ├── default.yaml             # Base configuration
│   ├── development.yaml         # Development settings
│   ├── production.yaml          # Production settings
│   └── test.yaml                # Test environment
├── src/                         # Source code
│   ├── _types_/                 # TypeScript type definitions
│   ├── api/                     # REST API routes (HTTP transport)
│   │   └── router.ts            # Express router with tsoa controllers
│   ├── prompts/                 # Agent prompts
│   │   ├── agent-brief.ts       # Agent brief
│   │   ├── agent-prompt.ts      # Main agent prompt
│   │   └── custom-prompts.ts    # Custom prompts
│   ├── tools/                   # MCP tool implementations
│   │   ├── handle-tool-call.ts  # Tool execution handler
│   │   └── tools.ts             # Tool definitions
│   ├── custom-resources.ts      # Custom MCP resources
│   └── start.ts                 # Application entry point
├── tests/                       # Test suites
│   ├── mcp/                     # MCP protocol tests
│   └── utils.ts                 # Test utilities
├── .env                         # Environment variables
├── package.json                 # NPM package configuration
└── tsconfig.json                # TypeScript configuration
```

## Main Initialization Function

### `initMcpServer(data: McpServerData): Promise<void>`

The primary function for starting your MCP server.

**Example Usage in `src/start.ts`:**

```typescript
import { initMcpServer, McpServerData, CustomAuthValidator } from 'fa-mcp-sdk';
import { tools } from './tools/tools.js';
import { handleToolCall } from './tools/handle-tool-call.js';
import { AGENT_BRIEF } from './prompts/agent-brief.js';
import { AGENT_PROMPT } from './prompts/agent-prompt.js';

// Optional: Custom Authentication validator (black box function)
const customAuthValidator: CustomAuthValidator = async (req): Promise<AuthResult> => {
  // Your custom authentication logic here - full request object available
  // Can access headers, IP, user-agent, etc.
  const authHeader = req.headers.authorization;
  const userID = req.headers['x-user-id'];
  const clientIP = req.headers['x-real-ip'] || req.connection?.remoteAddress;

  // Implement any authentication logic (database, LDAP, API, custom rules, etc.)
  const isAuthenticated = await authenticateRequest(req);

  if (isAuthenticated) {
    return {
      success: true,
      authType: 'basic',
      username: userID || 'unknown',
    };
  } else {
    return {
      success: false,
      error: 'Custom authentication failed',
    };
  }
};

const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  agentBrief: AGENT_BRIEF,
  agentPrompt: AGENT_PROMPT,

  // Optional: Provide custom authentication function
  customAuthValidator: customAuthValidator,

  // ... other configuration
};

await initMcpServer(serverData);
```

## Core Types and Interfaces

### `McpServerData`

Main configuration interface for your MCP server.

```typescript
interface McpServerData {
  // MCP Core Components
  tools: Tool[];                                    // Your tool definitions
  toolHandler: (params: { name: string; arguments?: any; headers?: Record<string, string> }) => Promise<any>; // Tool execution function

  // Agent Configuration
  agentBrief: string;                              // Brief description of your agent
  agentPrompt: string;                             // System prompt for your agent
  customPrompts?: IPromptData[];                   // Additional custom prompts

  // Resources
  requiredHttpHeaders?: IRequiredHttpHeader[] | null; // HTTP headers for authentication
  customResources?: IResourceData[] | null;        // Custom resource definitions

  // Authentication
  customAuthValidator?: CustomAuthValidator;           // Custom authentication validator function

  // HTTP Server Components (for HTTP transport)
  httpComponents?: {
    apiRouter?: Router | null;                     // Express router for additional endpoints
    endpointsOn404?: IEndpointsOn404;             // Custom 404 handling
    swagger?: ISwaggerData | null;                // OpenAPI/Swagger configuration
  };

  // UI Assets
  assets?: {
    favicon?: string;                              // SVG content for favicon
    maintainerHtml?: string;                       // Support contact HTML snippet
  };

  // Consul Integration
  getConsulUIAddress?: (serviceId: string) => string; // Function to generate Consul UI URLs
}
```

### `IPromptData`

Configuration for custom prompts in `src/prompts/custom-prompts.ts`.

```typescript
interface IPromptData {
  name: string;                                    // Unique prompt identifier
  description: string;                             // Human-readable description
  arguments: [];                                   // Expected arguments (currently empty array)
  content: IPromptContent;                         // Static string or dynamic function
  requireAuth?: boolean;                           // Whether authentication is required
}

type IPromptContent = string | TPromptContentFunction;
type TPromptContentFunction = (request: IGetPromptRequest) => string | Promise<string>;
```

Example `src/prompts/custom-prompts.ts`:
```typescript
import { IPromptData } from 'fa-mcp-sdk';

export const customPrompts: IPromptData[] = [
  {
    name: 'custom_prompt',
    description: 'A custom prompt for specific tasks',
    arguments: [],
    content: (request) => {
      const { sample } = request.params.arguments || {};
      return `Custom prompt content with parameter: ${sample}`;
    },
  },
];
```

### `IResourceData`

Configuration for custom resources in `src/custom-resources.ts`.

```typescript
interface IResourceData {
  uri: string;                                     // Unique resource URI (e.g., "custom-resource://data1")
  name: string;                                    // Resource name
  title?: string;                                  // Optional display title
  description: string;                             // Human-readable description
  mimeType: string;                                // MIME type (e.g., "text/plain", "application/json")
  content: IResourceContent;                       // Static content or dynamic function
  requireAuth?: boolean;                           // Whether authentication is required
}
```

Example `src/custom-resources.ts`:
```typescript
import { IResourceData } from 'fa-mcp-sdk';

export const customResources: IResourceData[] = [
  {
    uri: 'custom-resource://resource1',
    name: 'resource1',
    description: 'Example resource with dynamic content',
    mimeType: 'text/plain',
    content: (uri) => {
      return `Dynamic content for ${uri} at ${new Date().toISOString()}`;
    },
  },
];
```
