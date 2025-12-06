# FA-MCP-SDK API Documentation

## Overview

The FA-MCP-SDK is a comprehensive TypeScript framework for building Model Context 
Protocol (MCP) servers. This documentation covers how to use the SDK 
to create your own MCP server project.

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

# --------------------------------------------------
# CACHING Reduces API calls by caching responses
# --------------------------------------------------
cache:
   # Default Cache TTL in seconds
   ttlSeconds: 300
   # Default maximum number of cached items
   maxItems: 1000

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
      jwtToken:
         # Symmetric encryption key to generate a token for this MCP
         encryptKey: '***'
         # If webServer.auth.enabled and the parameter true, the service name and the service specified in the token will be checked
         checkMCPName: true
      #basic:
      #  username: '***'
      #  password: '***'
      #oauth2:
      #  type: 'oauth2';
      #  clientId: '***'
      #  clientSecret: '***'
      #  redirectUri?: 'string'
      #  tokenEndpoint?: string # For custom OAuth providers // VVR
      #pat: string;
```

**`config/local.yaml`** - local overrides. Usually contains secrets.

### Cache Management

#### `getCache(options?): CacheManager`

Get or create a global cache instance for your MCP server.

```typescript
import { getCache, CacheManager } from 'fa-mcp-sdk';

// Create default cache instance
const cache = getCache();

// Create cache with custom options
const customCache = getCache({
  ttlSeconds: 600,    // Default TTL: 10 minutes
  maxItems: 5000,     // Max cached items
  checkPeriod: 300,   // Cleanup interval in seconds
  verbose: true       // Enable debug logging
});
```

#### Cache Methods

The `CacheManager` provides the following methods:

| Method | Description | Example |
|--------|-------------|---------|
| `get<T>(key)` | Get value from cache | `const user = cache.get<User>('user:123');` |
| `set<T>(key, value, ttl?)` | Set value in cache | `cache.set('user:123', userData, 300);` |
| `has(key)` | Check if key exists | `if (cache.has('user:123')) { ... }` |
| `del(key)` | Delete key from cache | `cache.del('user:123');` |
| `take<T>(key)` | Get and delete (single use) | `const otp = cache.take<string>('otp:123');` |
| `mget<T>(keys[])` | Get multiple values | `const users = cache.mget(['user:1', 'user:2']);` |
| `mset(items[])` | Set multiple values | `cache.mset([{key: 'a', val: 1}, {key: 'b', val: 2}]);` |
| `getOrSet<T>(key, factory, ttl?)` | Get or compute value | `const data = await cache.getOrSet('key', () => fetchData());` |
| `keys()` | List all keys | `const allKeys = cache.keys();` |
| `flush()` | Clear all entries | `cache.flush();` |
| `ttl(key, seconds)` | Update key TTL | `cache.ttl('user:123', 600);` |
| `getTtl(key)` | Get remaining TTL | `const remaining = cache.getTtl('user:123');` |
| `getStats()` | Get cache statistics | `const stats = cache.getStats();` |
| `close()` | Close cache resources | `cache.close();` |

#### Usage Examples

```typescript
import { getCache } from 'fa-mcp-sdk';

const cache = getCache();

// Basic caching
cache.set('user:123', { name: 'John', email: 'john@example.com' });
const user = cache.get<User>('user:123');

// Cache with TTL (time to live)
cache.set('session:abc', sessionData, 1800); // 30 minutes

// Single-use values (OTP, tokens)
cache.set('otp:user123', '123456', 300);
const otp = cache.take('otp:user123'); // Gets and deletes

// Get-or-set pattern
const expensiveData = await cache.getOrSet(
  'computation:key',
  async () => {
    // This function runs only on cache miss
    return await performExpensiveOperation();
  },
  3600 // Cache for 1 hour
);

// Batch operations
const userData = cache.mget(['user:1', 'user:2', 'user:3']);
cache.mset([
  { key: 'user:1', val: user1Data },
  { key: 'user:2', val: user2Data, ttl: 600 }
]);

// Cache monitoring
const stats = cache.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
console.log(`Keys: ${stats.keys}, Memory: ${stats.vsize} bytes`);
```

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


// execMAIN - execute SQL commands without returning result set
// Function Signature:
const execMAIN = async (
  arg: string | IQueryPgArgsCOptional,
): Promise<number | undefined> {...}

// Examples:
await execMAIN('INSERT INTO logs (message, created_at) VALUES ($1, $2)',
  ['Server started', new Date()]);
await execMAIN({ sqlText: 'UPDATE users SET active = $1 WHERE id = $2', sqlValues: [false, userId] });

// queryRsMAIN - execute SQL and return rows array directly
// Function Signature:
const queryRsMAIN = async <R extends QueryResultRow = any> (
  arg: string | IQueryPgArgsCOptional,
  sqlValues?: any[],
  throwError = false,
): Promise<R[] | undefined> {...}

// Example:
const users = await queryRsMAIN<User>('SELECT * FROM users WHERE active = $1', [true]);

// oneRowMAIN - execute SQL and return single row
// Function Signature:
const oneRowMAIN = async <R extends QueryResultRow = any> (
  arg: string | IQueryPgArgsCOptional,
  sqlValues?: any[],
  throwError = false,
): Promise<R | undefined> {...}

// Example:
const user = await oneRowMAIN<User>('SELECT * FROM users WHERE id = $1', [userId]);

// getMainDBConnectionStatus - check database connection status
// Function Signature:
const getMainDBConnectionStatus = async (): Promise<string> {...}

// Possible return values: 'connected' | 'disconnected' | 'error' | 'db_not_used'
const status = await getMainDBConnectionStatus();

// checkMainDB - verify database connectivity (stops application if failed)
// Function Signature:
const checkMainDB = async (): Promise<void> {...}

// Example:
await checkMainDB(); // Throws or exits process if DB connection fails

// getInsertSqlMAIN - generate INSERT SQL statement
// Function Signature:
const getInsertSqlMAIN = async <U extends TDBRecord = TDBRecord> (arg: {
  commonSchemaAndTable: string,
  recordset: TRecordSet<U>,
  excludeFromInsert?: string[],
  addOutputInserted?: boolean,
  isErrorOnConflict?: boolean,
  keepSerialFields?: boolean,
}): Promise<string> {...}

// Example:
const insertSql = await getInsertSqlMAIN({
  commonSchemaAndTable: 'public.users',
  recordset: [{ name: 'John', email: 'john@example.com' }],
  addOutputInserted: true
});

// getMergeSqlMAIN - generate UPSERT (INSERT...ON CONFLICT) SQL statement
// Function Signature:
const getMergeSqlMAIN = async <U extends TDBRecord = TDBRecord> (arg: {
  commonSchemaAndTable: string,
  recordset: TRecordSet<U>,
  conflictFields?: string[],
  omitFields?: string[],
  updateFields?: string[],
  fieldsExcludedFromUpdatePart?: string[],
  noUpdateIfNull?: boolean,
  mergeCorrection?: (_sql: string) => string,
  returning?: string,
}): Promise<string> {...}

// Example:
const mergeSql = await getMergeSqlMAIN({
  commonSchemaAndTable: 'public.users',
  recordset: [{ id: 1, name: 'John Updated', email: 'john@example.com' }],
  conflictFields: ['email'],
  returning: '*'
});

// mergeByBatch - execute merge operations in batches
// Function Signature:
const mergeByBatch = async <U extends TDBRecord = TDBRecord> (arg: {
  recordset: TRecordSet<U>,
  getMergeSqlFn: Function
  batchSize?: number
}): Promise<any[]> {...}

// Example:
const results = await mergeByBatch({
  recordset: largeDataSet,
  getMergeSqlFn: (batch) => getMergeSqlMAIN({
    commonSchemaAndTable: 'public.users',
    recordset: batch
  }),
  batchSize: 500
});
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

// createJsonRpcErrorResponse - create JSON-RPC 2.0 error response
// Function Signature:
function createJsonRpcErrorResponse (
  error: Error | BaseMcpError,
  requestId?: string | number | null,
): any {...}

// Example:
try {
  // some operation
} catch (error) {
  const jsonRpcError = createJsonRpcErrorResponse(error, 'request-123');
  res.json(jsonRpcError);
}

// toError - safely convert any value to Error object
// Function Signature:
const toError = (err: any): Error {...}

// Examples:
const err1 = toError(new Error('Original error'));      // Returns original Error
const err2 = toError('String error message');           // Returns new Error('String error message')
const err3 = toError({ message: 'Object error' });      // Returns new Error('[object Object]')

// toStr - safely convert error to string message
// Function Signature:
const toStr = (err: any): string {...}

// Examples:
const msg1 = toStr(new Error('Test error'));           // Returns 'Test error'
const msg2 = toStr('String message');                  // Returns 'String message'
const msg3 = toStr(null);                              // Returns 'Unknown error'

// addErrorMessage - add context to existing error message
// Function Signature:
const addErrorMessage = (err: any, msg: string): void {...}

// Example:
const originalError = new Error('Connection failed');
addErrorMessage(originalError, 'Database operation failed');
// originalError.message is now: 'Database operation failed. Connection failed'
```

### Authentication and Security

#### Token-based Authentication

```typescript
import {
  authByToken,
  authTokenMW,
  ICheckTokenResult,
  checkToken,
  generateToken
} from 'fa-mcp-sdk';

// Types used:
export interface ICheckTokenResult {
  inTokenType?: TTokenType          // 'permanent' | 'JWT'
  payload?: ITokenPayload,          // Token payload with user data
  errorReason?: string,             // Error message if validation failed
  isTokenDecrypted?: boolean,       // Whether token was successfully decrypted
}

export interface ITokenPayload {
  user: string,                     // Username
  expire: number,                   // Expiration timestamp
  [key: string]: any,               // Additional payload data
}

// checkToken - validate token and return detailed result
// Function Signature:
const checkToken = (arg: {
  token: string,
  expectedUser?: string,
  expectedService?: string,
}): ICheckTokenResult {...}

// Example:
const tokenResult = checkToken({
  token: 'user_provided_token',
  expectedUser: 'john_doe',
  expectedService: 'my-mcp-server'
});

if (!tokenResult.errorReason) {
  console.log('Valid token for user:', tokenResult.payload?.user);
} else {
  console.log('Auth failed:', tokenResult.errorReason);
}

// generateToken - create JWT token
// Function Signature:
const generateToken = (user: string, liveTimeSec: number, payload?: any): string {...}

// Example:
const token = generateToken('john_doe', 3600, { role: 'admin' }); // 1 hour token

// authByToken - Express route handler for token validation
// Function Signature:
const authByToken = (req: Request, res: Response): boolean {...}

// Example:
app.post('/api/secure', (req, res) => {
  if (!authByToken(req, res)) {
    return; // Response already sent with error
  }
  // User is authenticated, continue with request
  res.json({ message: 'Access granted' });
});

// authTokenMW - Express middleware for token authentication
// Function Signature:
const authTokenMW = (req: Request, res: Response, next: NextFunction): void {...}

// Example:
import express from 'express';
const app = express();
app.use('/protected', authTokenMW); // Apply to all /protected/* routes
```

#### Token Generation

```typescript
import { generateTokenApp } from 'fa-mcp-sdk';

// generateTokenApp - start token generation web application
// Function Signature:
async function generateTokenApp (...args: any[]): Promise<void> {...}

// Starts a web server for generating authentication tokens
// Uses NTLM authentication if configured
// Web interface available at configured host:port

// Example:
await generateTokenApp(); // Uses default configuration from appConfig

// Token generation app provides:
// - Web interface for token creation
// - NTLM domain authentication support
// - JWT token generation with configurable expiration
// - Integration with Active Directory (if configured)

// Configuration in config/default.yaml:
// webServer:
//   auth:
//     token:
//       encryptKey: '***'           # Symmetric key for token encryption
//
// Optional NTLM configuration:
// ntlm:
//   domain: 'DOMAIN'
//   domainController: 'dc.domain.com'
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

// trim - safely trim string with null/undefined handling
// Function Signature:
const trim = (s: any): string {...}

// Examples:
const cleanText1 = trim('  hello  ');           // Returns 'hello'
const cleanText2 = trim(null);                  // Returns ''
const cleanText3 = trim(undefined);             // Returns ''
const cleanText4 = trim(123);                   // Returns '123'

// isMainModule - check if current module is the main entry point
// Function Signature:
const isMainModule = (url: string): boolean {...}

// Example:
if (isMainModule(import.meta.url)) {
  console.log('Running as main module');
  startServer();
}

// isObject - check if value is an object (not null, not array)
// Function Signature:
const isObject = (o: any): boolean {...}

// Examples:
isObject({});                    // Returns true
isObject({ key: 'value' });      // Returns true
isObject([]);                    // Returns false
isObject(null);                  // Returns false
isObject('string');              // Returns false

// isNonEmptyObject - check if value is non-empty object with defined values
// Function Signature:
const isNonEmptyObject = (o: any): boolean {...}

// Examples:
isNonEmptyObject({ key: 'value' });     // Returns true
isNonEmptyObject({});                   // Returns false
isNonEmptyObject({ key: undefined });   // Returns false
isNonEmptyObject([]);                   // Returns false

// ppj - pretty-print JSON with 2-space indentation
// Function Signature:
const ppj = (v: any): string {...}

// Example:
const formatted = ppj({ user: 'john', age: 30 });
// Returns:
// {
//   "user": "john",
//   "age": 30
// }

// encodeSvgForDataUri - encode SVG content for use in data URI
// Function Signature:
const encodeSvgForDataUri = (svg: string): string {...}

// Example:
const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
const encoded = encodeSvgForDataUri(svgContent);
const dataUri = `data:image/svg+xml,${encoded}`;

// getAsset - get asset file content from src/asset folder
// Function Signature:
const getAsset = (relPathFromAssetRoot: string): string | undefined {...}

// Example:
const logoContent = getAsset('logo.svg');         // Reads from src/asset/logo.svg
const iconContent = getAsset('icons/star.svg');   // Reads from src/asset/icons/star.svg
```

#### Network Utilities

```typescript
import { isPortAvailable, checkPortAvailability } from 'fa-mcp-sdk';

// isPortAvailable - check if port is available for binding
// Function Signature:
function isPortAvailable (port: number, host: string = '0.0.0.0'): Promise<boolean> {...}

// Examples:
const available1 = await isPortAvailable(3000);                    // Check on all interfaces
const available2 = await isPortAvailable(3000, 'localhost');       // Check on localhost
const available3 = await isPortAvailable(8080, '192.168.1.10');   // Check on specific IP

if (available1) {
  console.log('Port 3000 is available');
} else {
  console.log('Port 3000 is occupied');
}

// checkPortAvailability - check port with error handling
// Function Signature:
async function checkPortAvailability (
  port: number,
  host: string = '0.0.0.0',
  exitOnError: boolean = true
): Promise<void> {...}

// Examples:
try {
  // Throws error if port is busy
  await checkPortAvailability(3000, 'localhost', true);
  console.log('Port is available, can start server');
} catch (error) {
  console.log('Port is busy:', error.message);
}

// Don't exit process on busy port
try {
  await checkPortAvailability(3000, 'localhost', false);
  console.log('Port is available');
} catch (error) {
  console.log('Port is occupied, will use different port');
  // Continue execution instead of exiting
}
```

#### Tool Result Formatting

```typescript
import { formatToolResult, getJsonFromResult } from 'fa-mcp-sdk';

// formatToolResult - format tool execution results based on configuration
// Function Signature:
function formatToolResult (json: any): any {...}

// Behavior depends on appConfig.mcp.toolAnswerAs setting:
// - 'structuredContent': Returns { structuredContent: json }
// - 'text': Returns { content: [{ type: 'text', text: JSON.stringify(json, null, 2) }] }

// Examples:
const result = {
  message: 'Operation completed',
  data: { count: 42, items: ['a', 'b'] },
  timestamp: new Date().toISOString(),
};

const formattedResult = formatToolResult(result);

// If toolAnswerAs = 'structuredContent':
// {
//   structuredContent: {
//     message: 'Operation completed',
//     data: { count: 42, items: ['a', 'b'] },
//     timestamp: '2025-01-01T12:00:00.000Z'
//   }
// }

// If toolAnswerAs = 'text':
// {
//   content: [{
//     type: 'text',
//     text: '{\n  "message": "Operation completed",\n  "data": {\n    "count": 42,\n    "items": ["a", "b"]\n  },\n  "timestamp": "2025-01-01T12:00:00.000Z"\n}'
//   }]
// }

// getJsonFromResult - extract original JSON from formatted result
// Function Signature:
const getJsonFromResult = <T = any> (result: any): T {...}

// Examples:
const originalData1 = getJsonFromResult<MyDataType>(formattedResult);

// Works with both response formats:
const structuredResponse = { structuredContent: { user: 'john', age: 30 } };
const textResponse = {
  content: [{ type: 'text', text: '{"user":"john","age":30}' }]
};

const data1 = getJsonFromResult(structuredResponse);  // { user: 'john', age: 30 }
const data2 = getJsonFromResult(textResponse);        // { user: 'john', age: 30 }
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

// getConsulAPI - get configured Consul client instance
// Function Signature:
const getConsulAPI = async (): Promise<any> {...}

// Returns Consul API client configured from appConfig.consul settings
// Example:
const consulApi = await getConsulAPI();
const services = await consulApi.catalog.service.list();
console.log('Available services:', services);

// deregisterServiceFromConsul - remove service registration from Consul
// Function Signature:
const deregisterServiceFromConsul = async (): Promise<void> {...}

// Note: This function reads serviceId from command line arguments (process.argv)
// Usage in command line context:
// node script.js <serviceId> [agentHost] [agentPort]

// Example programmatic usage:
await deregisterServiceFromConsul();

// accessPointUpdater - manage access point lifecycle
// Object with start/stop methods:
const accessPointUpdater = {
  start(): void;    // Start automatic access point updates
  stop(): void;     // Stop automatic access point updates
}

// Examples:
accessPointUpdater.start();  // Automatically starts if appConfig.accessPoints configured
accessPointUpdater.stop();   // Stop updates (called automatically on shutdown)

// Access point configuration in config/default.yaml:
// accessPoints:
//   myService:
//     title: 'My remote service'
//     host: <host>
//     port: 9999
//     token: '***'
//     noConsul: true
//     consulServiceName: <consulServiceName>
```

### Graceful Shutdown

```typescript
import { gracefulShutdown } from 'fa-mcp-sdk';

// gracefulShutdown - perform graceful application shutdown
// Function Signature:
async function gracefulShutdown (signal: string, exitCode: number = 0): Promise<void> {...}

// Automatically handles:
// - Stopping Consul service registration
// - Closing database connections
// - Flushing file logs
// - Stopping access point updater
// - Process exit with specified code

// Examples:
// Manual shutdown
process.on('SIGUSR2', () => {
  gracefulShutdown('SIGUSR2', 0);
});

// Emergency shutdown
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION', 1);
});

// Note: SDK automatically registers SIGINT and SIGTERM handlers
// in initMcpServer(), so manual registration is only needed for custom signals
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

This documentation provides everything needed to build, test, and deploy your own 
MCP server using the FA-MCP-SDK framework.
