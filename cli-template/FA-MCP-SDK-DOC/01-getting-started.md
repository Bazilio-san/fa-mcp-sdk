# Getting Started

## initMcpServer(data: McpServerData): Promise<void>

Primary function for starting your MCP server.

```typescript
import { initMcpServer, McpServerData, CustomAuthValidator } from 'fa-mcp-sdk';
import { tools } from './tools/tools.js';
import { handleToolCall } from './tools/handle-tool-call.js';

const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  agentBrief: 'My agent description',
  agentPrompt: 'Full agent instructions',
  customAuthValidator: async (req) => { /* custom auth logic */ },
};

await initMcpServer(serverData);
```

## Core Types

### McpServerData

```typescript
interface McpServerData {
  tools: Tool[] | (() => Promise<Tool[]>);           // Tool definitions
  toolHandler: (params: IToolHandlerParams) => Promise<any>;
  agentBrief: string;                                 // Brief description
  agentPrompt: string;                                // System prompt
  customPrompts?: IPromptData[];                      // Additional prompts
  usedHttpHeaders?: IUsedHttpHeader[] | null;         // HTTP headers for auth
  customResources?: IResourceData[] | null;           // Custom resources
  customAuthValidator?: CustomAuthValidator;          // Custom auth function
  tokenGenAuthHandler?: TokenGenAuthHandler;          // Token Generator auth
  httpComponents?: { apiRouter?: Router | null };     // Express router
  assets?: { logoSvg?: string; maintainerHtml?: string };
  getConsulUIAddress?: (serviceId: string) => string;
}

interface IToolHandlerParams {
  name: string;
  arguments?: any;
  headers?: Record<string, string>;
  payload?: { user: string; [key: string]: any };     // JWT payload if authenticated
  transport?: 'stdio' | 'sse' | 'http';
}
```

### IPromptData

For custom prompts in `src/prompts/custom-prompts.ts`:

```typescript
interface IPromptData {
  name: string;
  description: string;
  arguments: [];
  content: string | ((request: IGetPromptRequest) => string | Promise<string>);
  requireAuth?: boolean;
}

// Example:
export const customPrompts: IPromptData[] = [{
  name: 'custom_prompt',
  description: 'A custom prompt',
  arguments: [],
  content: (request) => `Content with param: ${request.params.arguments?.sample}`,
}];
```

### IResourceData

For custom resources in `src/custom-resources.ts`:

```typescript
interface IResourceData {
  uri: string;            // e.g., "custom-resource://data1"
  name: string;
  title?: string;
  description: string;
  mimeType: string;       // e.g., "text/plain", "application/json"
  content: string | object | ((uri: string) => string | Promise<string>);
  requireAuth?: boolean;
}

// Example:
export const customResources: IResourceData[] = [{
  uri: 'custom-resource://resource1',
  name: 'resource1',
  description: 'Dynamic content example',
  mimeType: 'text/plain',
  content: (uri) => `Dynamic content for ${uri}`,
}];
```

## Configuration API

### appConfig

Singleton with merged configuration from YAML files and environment variables:

```typescript
import { appConfig, AppConfig } from 'fa-mcp-sdk';

const port = appConfig.webServer.port;
const serviceName = appConfig.name;
const isAuthEnabled = appConfig.webServer.auth.enabled;

// Nested config access
const dbHost = appConfig.db.postgres.dbs.main.host;
const rateLimit = appConfig.mcp.rateLimit.maxRequests;
const dbEnabled = appConfig.isMainDBUsed;
```

| Property | Description |
|----------|-------------|
| `name` | Package name from package.json |
| `shortName` | Name without 'mcp' suffix |
| `version` | Package version |
| `webServer` | HTTP server config (host, port, auth) |
| `mcp` | MCP settings (transportType, rateLimit) |
| `logger` | Logging config |
| `ad` | Active Directory config |
| `consul` | Service discovery settings |

### getProjectData(): McpServerData

Returns the data passed to `initMcpServer()`.

```typescript
const projectData = getProjectData();
console.log(projectData.agentBrief, projectData.tools.length);
```

### getSafeAppConfig(): any

Returns config clone with sensitive data masked. Use for logging:

```typescript
const safeConfig = getSafeAppConfig();
console.log(JSON.stringify(safeConfig, null, 2)); // passwords masked
```
