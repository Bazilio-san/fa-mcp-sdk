# FA-MCP-SDK API Documentation

## Overview

The FA-MCP-SDK is a comprehensive TypeScript framework for building Model Context Protocol (MCP) servers. This documentation covers how to use the SDK to create your own MCP server project.

## Getting Started

### Installation

```bash
npm install fa-mcp-sdk
```

### Project Structure

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
│   │   ├── router.ts            # Express router
│   │   └── swagger.ts           # API documentation
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

## Core API Reference

### Main Initialization Function

#### `initMcpServer(data: McpServerData): Promise<void>`

The primary function for starting your MCP server.

**Example Usage in `src/start.ts`:**

```typescript
import { initMcpServer, McpServerData } from 'fa-mcp-sdk';
import { tools } from './tools/tools.js';
import { handleToolCall } from './tools/handle-tool-call.js';
import { AGENT_BRIEF } from './prompts/agent-brief.js';
import { AGENT_PROMPT } from './prompts/agent-prompt.js';

const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  agentBrief: AGENT_BRIEF,
  agentPrompt: AGENT_PROMPT,
  // ... other configuration
};

await initMcpServer(serverData);
```

### Core Types and Interfaces

#### `McpServerData`

Main configuration interface for your MCP server.

```typescript
interface McpServerData {
  // MCP Core Components
  tools: Tool[];                                    // Your tool definitions
  toolHandler: (params: { name: string; arguments?: any }) => Promise<any>; // Tool execution function

  // Agent Configuration
  agentBrief: string;                              // Brief description of your agent
  agentPrompt: string;                             // System prompt for your agent
  customPrompts?: IPromptData[];                   // Additional custom prompts

  // Resources
  requiredHttpHeaders?: IRequiredHttpHeader[] | null; // HTTP headers for authentication
  customResources?: IResourceData[] | null;        // Custom resource definitions

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

#### `IPromptData`

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

#### `IResourceData`

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

### Tool Development

#### Tool Definition in `src/tools/tools.ts`

```typescript
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { IToolInputSchema } from 'fa-mcp-sdk';

export const tools: Tool[] = [
  {
    name: 'my_custom_tool',
    description: 'Description of what this tool does',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Input query or text',
        },
        options: {
          type: 'object',
          description: 'Optional configuration',
        },
      },
      required: ['query'],
    },
  },
];
```

#### Tool Handler in `src/tools/handle-tool-call.ts`

```typescript
import { formatToolResult, ToolExecutionError, logger } from 'fa-mcp-sdk';

export const handleToolCall = async (params: { name: string, arguments?: any }): Promise<any> => {
  const { name, arguments: args } = params;

  logger.info(`Tool called: ${name}`);

  try {
    switch (name) {
      case 'my_custom_tool':
        return await handleMyCustomTool(args);

      default:
        throw new ToolExecutionError(name, `Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Tool execution failed for ${name}:`, error);
    throw error;
  }
};

async function handleMyCustomTool(args: any): Promise<string> {
  const { query, options } = args || {};

  if (!query) {
    throw new ToolExecutionError('my_custom_tool', 'Query parameter is required');
  }

  // Your tool logic here
  const result = {
    message: `Processed: ${query}`,
    timestamp: new Date().toISOString(),
    options: options || {},
  };

  return formatToolResult(result);
}
```

### Configuration Management

#### Using `appConfig`

Access configuration in your code:

```typescript
import { appConfig } from 'fa-mcp-sdk';

// Access configuration values
const serverPort = appConfig.webServer.port;
const dbEnabled = appConfig.isMainDBUsed;
const transport = appConfig.mcp.transportType; // 'stdio' | 'http'
```

#### Configuration Files

**`config/default.yaml`** - Base configuration:
```yaml
accessPoints:
  myService:
    title: 'My remote service'
    host: <host>
    port: 9999
    token: '***'
    noConsul: true # Use if the service developers do not provide registration in consul
    consulServiceName: <consulServiceName>

consul:
   check:
      interval: '10s'
      timeout: '5s'
      deregistercriticalserviceafter: '3m'
   agent:
      # Credentials for getting information about services in the DEV DC
      dev:
         dc: '{{consul.agent.dev.dc}}'
         host: '{{consul.agent.dev.host}}'
         port: 443
         secure: true
         # Token for getting information about DEV services
         token: '***'
      # Credentials for getting information about services in the PROD DC
      prd:
         dc: '{{consul.agent.prd.dc}}'
         host: '{{consul.agent.prd.host}}'
         port: 443
         secure: true
         # Token for obtaining information about PROD services
         token: '***'
      # Credentials for registering the service with Consul
      reg:
         # The host of the consul agent where the service will be registered. If not specified, the server on which the service is running is used
         host: null
         port: 8500
         secure: false
         # Token for registering the service in the consul agent
         token: '***'
   service:
      enable: {{consul.service.enable}} # true - Allows registration of the service with the consul
      name: <name> # <name> will be replaced by <package.json>.name at initialization
      instance: '{{SERVICE_INSTANCE}}' # This value will be specified as a suffix in the id of the service
      version: <version> # <version> will be replaced by <package.json>.version at initialization
      description: <description> # <description> will be replaced by <package.json>.description at initialization
      tags: [] # If null or empty array - Will be pulled up from package.keywords at initialization
      meta:
         # "About" page link template
         who: 'http://{address}:{port}/'
   envCode: # Used to generate the service ID
      prod: {{consul.envCode.prod}} # Production environment code
      dev: {{consul.envCode.dev}} # Development environment code

db:
   postgres:
      dbs:
         main:
            label: 'My Database'
            host: ''  # To exclude the use of the database, you need to set host = ''
            port: 5432
            database: <database>
            user: <user>
            password: <password>
            usedExtensions: []

logger:
   level: info
   useFileLogger: {{logger.useFileLogger}} # To use or not to use logging to a file
   # Absolute path to the folder where logs will be written. Default <proj_root>/../logs
   dir: '{{logger.dir}}'

mcp:
   transportType: http # stdio | http
   # Response format configuration.
   # - structuredContent - default - the response in result.structuredContent returns JSON
   # - text - in the response, serialized JSON is returned in result.content[0].text
   toolAnswerAs: text # text | structuredContent
   rateLimit:
      maxRequests: 100
      windowMs: 60000  # 1 minute

swagger:
   servers:  # An array of servers that will be added to swagger docs
      # - url: http://localhost:9020
      #   description: "Development server (localhost)"
      # - url: http://0.0.0.0:9020
      #   description: "Development server (all interfaces)"
      # - url: http://<prod_server_host_or_ip>:{{port}}
      #   description: "PROD server"
      - url: https://{{mcp.domain}}
        description: "PROD server"

uiColor:
   # Font color of the header and a number of interface elements on the ABOUT page
   primary: '#0f65dc'

webServer:
   host: '0.0.0.0'
   port: {{port}}
   # array of hosts that CORS skips
   originHosts: ['localhost', '0.0.0.0']
   auth:
      enabled: false # Enables/disables token authorization
      # An array of fixed tokens that pass to the MCP (use only for MCPs with green data or for development)
      permanentServerTokens: []
      token:
         # Symmetric encryption key to generate a token for this MCP
         encryptKey: '***'
         # If webServer.auth.enabled and the parameter true, the service name and the service specified in the token will be checked
         checkMCPName: true
```

**`config/local.yaml`** - local overrides. Usually contains secrets.

### Database Integration

To disable the use of the database, you need to set appConfig.db.postgres.dbs.main.host to an empty value.
In this case, when the configuration is formed, appConfig.isMainDBUsed is set to false.


If you enable database support (`isMainDBUsed: true` in config):

```typescript
import {
  queryMAIN,
  execMAIN,
  oneRowMAIN,
  getMainDBConnectionStatus
} from 'fa-mcp-sdk';

// Check database connection. If there is no connection, the application stops
await checkMainDB();

// queryMAIN - the main function of executing SQL queries to the main database

// Function Signature:
const queryMAIN = async <R extends QueryResultRow = any> (
        arg: string | IQueryPgArgsCOptional,
        sqlValues?: any[],
        throwError = false,
): Promise<QueryResult<R> | undefined> {...}

// Types used:
export interface IQueryPgArgs {
   connectionId: string,
   poolConfig?: PoolConfig & IDbOptionsPg,
   client?: IPoolPg,
   sqlText: string,
   sqlValues?: any[],
   throwError?: boolean,
   prefix?: string,
   registerTypesFunctions?: IRegisterTypeFn[],
}
export interface IQueryPgArgsCOptional extends Omit<IQueryPgArgs, 'connectionId'> {
   connectionId?: string
}

// Examples of use
const users1 = await queryMAIN('SELECT * FROM users WHERE active = $1', [true]);
// Alternative use case
const users2 = await queryMAIN({ sqlText: 'SELECT * FROM users WHERE active = $1', sqlValues: [true] });


// Execute commands
await execMAIN('INSERT INTO logs (message, created_at) VALUES ($1, $2)',
  ['Server started', new Date()]);

// Get single row
const user = await oneRowMAIN('SELECT * FROM users WHERE id = $1', [userId]);

// Check connection status
const status = await getMainDBConnectionStatus(); // 'connected' | 'disconnected' | 'error'
```

### Error Handling

#### Custom Error Classes

```typescript
import { BaseMcpError, ToolExecutionError, ValidationError } from 'fa-mcp-sdk';

// Create custom error types
class MyCustomError extends BaseMcpError {
  constructor(message: string) {
    super(message, 'CUSTOM_ERROR');
  }
}

// Use built-in error types
if (!validInput) {
  throw new ValidationError('Input validation failed');
}

if (toolFailed) {
  throw new ToolExecutionError('my_tool', 'Tool execution failed');
}
```

#### Error Utilities

```typescript
import {
  createJsonRpcErrorResponse,
  toError,
  toStr,
  addErrorMessage
} from 'fa-mcp-sdk';

// Create JSON-RPC error responses
const errorResponse = createJsonRpcErrorResponse('request-123', error);

// Convert values to Error objects
const err = toError(someValue);

// Safe string conversion
const message = toStr(errorData);

// Add context to errors
const enhancedError = addErrorMessage(originalError, 'Additional context');
```

### Authentication and Security

#### Token-based Authentication

```typescript
import { authByToken, authTokenMW, ICheckTokenResult } from 'fa-mcp-sdk';

// Validate authentication token
const tokenResult: ICheckTokenResult = await authByToken(token);

if (tokenResult.valid) {
  console.log('User:', tokenResult.user);
} else {
  console.log('Auth failed:', tokenResult.error);
}

// Use as Express middleware (for HTTP transport)
import express from 'express';
const app = express();
app.use('/protected', authTokenMW);
```

#### Token Generation

Start a token generation web application:

```typescript
import { generateTokenApp } from 'fa-mcp-sdk';

// Start token generation service
await generateTokenApp(/* configuration options */);
```

### Utility Functions

#### General Utilities

```typescript
import {
  trim,
  isMainModule,
  isNonEmptyObject,
  isObject,
  ppj,
  encodeSvgForDataUri,
  getAsset
} from 'fa-mcp-sdk';

// Safe string trimming
const cleanText = trim(userInput);

// Check if running as main module
if (isMainModule(import.meta.url)) {
  console.log('Running as main');
}

// Object validation
if (isNonEmptyObject(data)) {
  // Process data
}

// Pretty-print JSON
console.log(ppj(complexObject));

// Encode SVG for data URI
const favicon = encodeSvgForDataUri(svgContent);

// Get asset content
const logoContent = getAsset('path/to/logo.svg');
```

#### Network Utilities

```typescript
import { isPortAvailable, checkPortAvailability } from 'fa-mcp-sdk';

// Check if port is available
const available = await isPortAvailable(3000, 'localhost');

// Check with error handling
try {
  await checkPortAvailability(3000, 'localhost', true); // throws if busy
  console.log('Port is available');
} catch (error) {
  console.log('Port is busy');
}
```

#### Tool Result Formatting

```typescript
import { formatToolResult, getJsonFromResult } from 'fa-mcp-sdk';

// Format tool results consistently
const result = {
  data: processedData,
  timestamp: new Date().toISOString(),
};

const formattedResult = formatToolResult(result);

// Extract JSON from formatted result
const originalData = getJsonFromResult(formattedResult);
```

### Logging

```typescript
import { logger, fileLogger } from 'fa-mcp-sdk';

// Console logging
logger.info('Server started successfully');
logger.warn('Warning message');
logger.error('Error occurred', error);

// File logging (if configured)
fileLogger.info('This goes to file');

// Ensure file logs are written before shutdown
await fileLogger.asyncFinish();
```

### Event System

```typescript
import { eventEmitter } from 'fa-mcp-sdk';

// Listen for events
eventEmitter.on('server:started', (data) => {
  console.log('Server started with config:', data);
});

// Emit custom events
eventEmitter.emit('custom:event', { data: 'example' });
```

### Testing Your MCP Server

#### Test Structure

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

#### Test Clients

Use the provided test clients to test your MCP server:

**STDIO Transport Testing:**
```typescript
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

#### Test Categories and Recommendations

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

### Consul Integration

If using Consul for service discovery:

```typescript
import {
  getConsulAPI,
  accessPointUpdater,
  deregisterServiceFromConsul
} from 'fa-mcp-sdk';

// Get Consul client
const consul = await getConsulAPI();

// Access point management starts automatically if configured

// Manual service deregistration
await deregisterServiceFromConsul('my-service-id');

// Access point updater control (usually automatic)
accessPointUpdater.start();
accessPointUpdater.stop();
```

### Graceful Shutdown

The SDK handles graceful shutdown automatically, but you can also use it manually:

```typescript
import { gracefulShutdown } from 'fa-mcp-sdk';

// Manual shutdown
process.on('SIGUSR2', () => {
  gracefulShutdown('SIGUSR2', 0);
});
```

### Transport Types

#### STDIO Transport
- Use for CLI tools and local development
- Configure with `mcp.transportType: "stdio"`
- Lightweight, no HTTP overhead

#### HTTP Transport
- Use for web-based integrations
- Configure with `mcp.transportType: "http"`
- Supports REST API, authentication, Swagger docs
- Requires `webServer` configuration

#### Server-Sent Events (SSE)
- Real-time streaming over HTTP
- Good for long-running operations
- Maintains persistent connections

### Best Practices

#### Project Organization
1. **Keep tools focused** - One responsibility per tool
2. **Use TypeScript** - Leverage type safety throughout
3. **Organize by feature** - Group related functionality
4. **Configure environments** - Use separate configs for dev/prod

#### Tool Development
1. **Validate inputs** - Always check required parameters
2. **Use formatToolResult()** - Consistent response formatting
3. **Handle errors gracefully** - Use appropriate error classes
4. **Log operations** - Use the provided logger

#### Testing
1. **Test all transports** - Ensure compatibility
2. **Include error cases** - Test failure scenarios
3. **Use provided clients** - Leverage built-in test utilities
4. **Document test cases** - Clear, descriptive test names

#### Security
1. **Environment variables** - Never hardcode secrets
2. **Authentication** - Enable for production HTTP servers
3. **Input validation** - Validate all user inputs
4. **Error messages** - Don't leak sensitive information

This documentation provides everything needed to build, test, and deploy your own MCP server using the FA-MCP-SDK framework.
