# Prompts and Resources

This document describes MCP prompts and resources provided by FA-MCP-SDK.

## Prompts

Prompts are text instructions that LLM receives when working with your MCP server. 
The SDK provides two standard prompts that must be configured for each new MCP server.

### Standard Prompts

#### Agent Brief (`src/prompts/agent-brief.ts`)

**Level 1: Brief agent description**

This is a short description shown when LLM selects an agent from a list based on 
user query. At this level, LLM doesn't see the list of tools — only the brief description.

```typescript
/**
 * Level 1: Brief agent description
 * Used when LLM selects agents from a list based on user query
 * LLM doesn't see tools at this level
 */

export const AGENT_BRIEF = 'Your short agent description here';
```

**Example:**
```typescript
export const AGENT_BRIEF = 'Database management agent for PostgreSQL operations';
```

#### Agent Prompt (`src/prompts/agent-prompt.ts`)

**Level 2: Full agent description**

This prompt becomes visible to the LLM after the agent router has selected this 
agent from among others based on their short descriptions. At this point, the 
LLM gains access to the full list of tools and this detailed prompt, which may 
include instructions on how to call those tools.

In simple scenarios, this prompt can be very short or even empty if the tool descriptions alone are sufficient.

```typescript
/**
 * Level 2: Agent description
 * This prompt becomes visible to the LLM after the agent router has selected
 * this agent from among others based on their short descriptions.
 * At that point, the LLM gains access to the full list of tools and this
 * detailed prompt, which may include instructions on how to call those tools.
 * In simple scenarios, this prompt can be very short or even empty if the
 * tool descriptions alone are sufficient.
 */

export const AGENT_PROMPT = `Your detailed agent instructions here.

Available tools:
- tool1: description
- tool2: description

Usage guidelines:
...
`;
```

**Example:**
```typescript
export const AGENT_PROMPT = `You are a database management assistant for PostgreSQL.

Guidelines:
- Always check table existence before operations
- Use transactions for multi-step operations
- Return results in JSON format

Available tools will help you:
- Query data from tables
- Execute DDL/DML statements
- Manage database schema
`;
```

### Custom Prompts

You can add additional prompts in `src/prompts/custom-prompts.ts`. These prompts 
are exposed via the MCP `prompts/list` and `prompts/get` endpoints.

#### Interface

```typescript
interface IPromptData {
  name: string;           // Prompt identifier
  description: string;    // Description shown in prompts list
  arguments: [];          // Prompt arguments (currently empty array)
  content: IPromptContent;// Static string or function returning content
  requireAuth?: boolean;  // If true, prompt requires authentication
}

type TPromptContentFunction = (request: IGetPromptRequest) => string | Promise<string>;
type IPromptContent = string | TPromptContentFunction;

interface IGetPromptRequest {
  id?: string | number;
  method: 'prompts/get' | 'prompts/content';
  params: {
    name: string;
    arguments?: Record<string, string>;
  };
}
```

#### Example

```typescript
import { IPromptData, IGetPromptRequest } from '../../core/index.js';

export const customPrompts: IPromptData[] = [
  // Simple static prompt
  {
    name: 'greeting',
    description: 'Standard greeting message',
    arguments: [],
    content: 'Hello! How can I help you today?',
  },

  // Dynamic prompt with function
  {
    name: 'context_prompt',
    description: 'Context-aware prompt',
    arguments: [],
    content: (request: IGetPromptRequest) => {
      const args = request.params.arguments || {};
      return `Processing request with context: ${JSON.stringify(args)}`;
    },
  },

  // Protected prompt requiring authentication
  {
    name: 'admin_instructions',
    description: 'Administrative instructions',
    arguments: [],
    content: 'Admin-only instructions for system management...',
    requireAuth: true,  // Requires valid authentication
  },
];
```

#### Connecting Custom Prompts

Pass custom prompts to `initMcpServer()` via `McpServerData`:

```typescript
import { initMcpServer, McpServerData } from 'fa-mcp-sdk';
import { customPrompts } from './prompts/custom-prompts.js';

const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  agentBrief: AGENT_BRIEF,
  agentPrompt: AGENT_PROMPT,
  customPrompts,  // Add custom prompts here
};

await initMcpServer(serverData);
```

---

## Resources

Resources are data exposed via MCP `resources/list` and `resources/read` endpoints. 
The SDK provides standard resources and supports custom resources.

### Standard Resources

The SDK automatically provides the following resources:

| URI                       | Name | Description |
|---------------------------|------|-------------|
| `project://id`            | project-id | Stable project identifier. Used for MCP server identification in registries and JWT authorization |
| `project://name`          | product-name | Human-readable product name for UI display |
| `doc://readme`            | README.md | Project documentation from README.md file. Used by RAG systems in MCP registries for search |
| `required://http-headers` | Required http headers | List of required HTTP headers (if configured via `requiredHttpHeaders`) |

**Resource content sources:**
- `project://id` → `appConfig.name` from configuration
- `project://name` → `appConfig.productName` from configuration
- `doc://readme` → `README.md` file from project root
- `required://http-headers` → `requiredHttpHeaders` array from `McpServerData`

### Custom Resources

Add custom resources in `src/custom-resources.ts`.

#### Interface

```typescript
interface IResourceInfo {
  uri: string;           // Resource URI (e.g., 'custom://my-resource')
  name: string;          // Resource name
  title?: string;        // Optional title
  description: string;   // Description shown in resources list
  mimeType: string;      // MIME type (e.g., 'text/plain', 'application/json')
  requireAuth?: boolean; // If true, resource requires authentication
}

interface IResourceData extends IResourceInfo {
  content: IResourceContent;
}

type TResourceContentFunction = (uri: string) => string | Promise<string>;
type IResourceContent = string | object | TResourceContentFunction;
```

#### Example

```typescript
import { IResourceData } from '../core/index.js';

export const customResources: IResourceData[] = [
  // Simple static resource
  {
    uri: 'custom://config-info',
    name: 'Configuration Info',
    description: 'Server configuration summary',
    mimeType: 'text/plain',
    content: 'Server version: 1.0.0\nEnvironment: production',
  },

  // JSON resource
  {
    uri: 'custom://api-schema',
    name: 'API Schema',
    description: 'API schema definition',
    mimeType: 'application/json',
    content: {
      version: '1.0',
      endpoints: ['/api/users', '/api/orders'],
    },
  },

  // Dynamic resource with async function
  {
    uri: 'custom://status',
    name: 'Server Status',
    description: 'Current server status',
    mimeType: 'application/json',
    content: async (uri: string) => {
      const status = await getServerStatus();
      return JSON.stringify(status);
    },
  },

  // Protected resource requiring authentication
  {
    uri: 'custom://secrets',
    name: 'Secret Configuration',
    description: 'Protected configuration data',
    mimeType: 'application/json',
    content: { apiKeys: ['...'], credentials: {...} },
    requireAuth: true,  // Requires valid authentication
  },
];
```

#### Connecting Custom Resources

Pass custom resources to `initMcpServer()` via `McpServerData`:

```typescript
import { initMcpServer, McpServerData } from 'fa-mcp-sdk';
import { customResources } from './custom-resources.js';

const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  agentBrief: AGENT_BRIEF,
  agentPrompt: AGENT_PROMPT,
  customResources,  // Add custom resources here
};

await initMcpServer(serverData);
```

### Required HTTP Headers

You can define required HTTP headers that clients must send when making requests:

```typescript
interface IRequiredHttpHeader {
  name: string;         // Header name (e.g., "Authorization")
  description: string;  // Description (e.g., "JWT Token issued on request")
  isOptional?: boolean; // If true, header is optional
}
```

**Example:**
```typescript
const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  agentBrief: AGENT_BRIEF,
  agentPrompt: AGENT_PROMPT,
  requiredHttpHeaders: [
    {
      name: 'Authorization',
      description: 'JWT token in Bearer format',
    },
    {
      name: 'X-Request-ID',
      description: 'Optional request tracking ID',
      isOptional: true,
    },
  ],
};
```

When `requiredHttpHeaders` is configured, the resource `required://http-headers` becomes available with this information.

---

## Access Control with requireAuth

Both prompts and resources support the `requireAuth` property for access control:

```typescript
{
  // ... other properties
  requireAuth: true,  // Requires valid authentication
}
```

When `requireAuth: true`:
- The prompt/resource is only accessible to authenticated users
- Unauthenticated requests receive an error
- Works with any authentication method configured in your server (JWT, Basic, NTLM, etc.)

**Use cases:**
- Sensitive configuration data
- Admin-only instructions
- Internal documentation
- API keys and credentials
