# Utilities, Errors, and Logging

## Error Handling

### Custom Error Classes

```typescript
import { BaseMcpError, ToolExecutionError, ValidationError, ServerError } from 'fa-mcp-sdk';

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

### `ServerError`

Server-related error class for internal MCP server failures. Use for unexpected server-side errors that aren't tool-specific.

```typescript
import { ServerError } from 'fa-mcp-sdk';

// Class Definition:
class ServerError extends BaseMcpError {
  constructor(
    message: string,
    details?: Record<string, unknown>,
    printed?: boolean
  );
}

// Examples:
throw new ServerError('Database connection failed');

throw new ServerError('Configuration error', {
  configKey: 'webServer.port',
  expected: 'number',
  received: 'string'
});

// With printed flag (prevents duplicate logging)
throw new ServerError('Internal error', undefined, true);
```

**Properties:**
- `code`: Always `'SERVER_ERROR'`
- `httpStatus`: Always `500`
- `details`: Optional additional error context

### Error Utilities

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

---

## Constants

### `ROOT_PROJECT_DIR`

Absolute path to the project root directory. Calculated at runtime based on `process.cwd()`.

```typescript
import { ROOT_PROJECT_DIR } from 'fa-mcp-sdk';

// Constant Definition:
const ROOT_PROJECT_DIR: string = process.cwd();

// Example usage:
import * as path from 'path';

const configPath = path.join(ROOT_PROJECT_DIR, 'config', 'default.yaml');
const assetsPath = path.join(ROOT_PROJECT_DIR, 'src', 'assets');

console.log('Project root:', ROOT_PROJECT_DIR);
// Output: /home/user/my-mcp-server
```

**Use Cases:**
- Building absolute paths to project files
- Locating configuration files
- Resolving asset paths

---

## Utility Functions

### General Utilities

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

### HTTP Utilities

```typescript
import { normalizeHeaders } from 'fa-mcp-sdk';

// normalizeHeaders - Normalize HTTP headers for consistent access
// Function Signature:
function normalizeHeaders(headers: Record<string, any>): Record<string, string>;

// Features:
// - Converts all header names to lowercase
// - Joins array values with ', ' separator
// - Filters out null/undefined values
// - Converts non-string values to strings

// Example:
const rawHeaders = {
  'Authorization': 'Bearer token123',
  'X-Custom-Header': 'value',
  'Accept-Language': ['en', 'ru'],
  'X-Null-Header': null,
};

const normalized = normalizeHeaders(rawHeaders);
// Result:
// {
//   'authorization': 'Bearer token123',
//   'x-custom-header': 'value',
//   'accept-language': 'en, ru'
// }

// Common use case - accessing headers in tool handler:
import { IToolHandlerParams } from 'fa-mcp-sdk';

export const handleToolCall = async (params: IToolHandlerParams): Promise<any> => {
  const { headers } = params;

  // Headers are already normalized by SDK, access with lowercase keys
  const authHeader = headers?.authorization;
  const userAgent = headers?.['user-agent'];
  const clientIP = headers?.['x-real-ip'] || headers?.['x-forwarded-for'];

  // ...
};
```

### Tool Utilities

```typescript
import { getTools } from 'fa-mcp-sdk';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// getTools - Get the list of registered MCP tools
// Function Signature:
async function getTools(): Promise<Tool[]>;

// Retrieves tools from the project data passed to initMcpServer()
// Supports both static arrays and dynamic tool functions

// Example:
const tools = await getTools();
console.log(`Registered tools: ${tools.length}`);
tools.forEach(tool => {
  console.log(`- ${tool.name}: ${tool.description}`);
});

// Useful for:
// - Introspection and debugging
// - Dynamic tool documentation
// - Tool validation in tests
```

### Network Utilities

```typescript
import { isPortAvailable, checkPortAvailability } from 'fa-mcp-sdk';

// isPortAvailable - check if port is available for binding
// Function Signature:
function isPortAvailable (port: number, host: string = '0.0.0.0'): Promise<boolean> {...}

// Examples:
const available1 = await isPortAvailable(1234);                    // Check on all interfaces
const available2 = await isPortAvailable(1234, 'localhost');       // Check on localhost
const available3 = await isPortAvailable(1234, '192.168.1.10');   // Check on specific IP

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

### Tool Result Formatting

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

---

## Logging

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

---

## Event System

```typescript
import { eventEmitter } from 'fa-mcp-sdk';

// Listen for events
eventEmitter.on('server:started', (data) => {
  console.log('Server started with config:', data);
});

// Emit custom events
eventEmitter.emit('custom:event', { data: 'example' });
```

---

## Consul Integration

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

---

## Graceful Shutdown

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
