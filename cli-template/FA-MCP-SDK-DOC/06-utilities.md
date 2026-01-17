# Utilities, Errors, and Logging

## Error Classes

```typescript
import { BaseMcpError, ToolExecutionError, ValidationError, ServerError } from 'fa-mcp-sdk';

throw new ValidationError('Input validation failed');
throw new ToolExecutionError('my_tool', 'Execution failed');
throw new ServerError('Database connection failed', { key: 'value' });

// Custom error
class MyError extends BaseMcpError {
  constructor(msg: string) { super(msg, 'MY_ERROR'); }
}
```

**ServerError**: `code: 'SERVER_ERROR'`, `httpStatus: 500`

## Error Utilities

```typescript
import { createJsonRpcErrorResponse, toError, toStr, addErrorMessage } from 'fa-mcp-sdk';

// Create JSON-RPC error response
const response = createJsonRpcErrorResponse(error, 'request-123');

// Safe error conversion
const err = toError(anything);      // → Error object
const msg = toStr(anything);        // → string message

// Add context to error
addErrorMessage(error, 'Operation failed');
// error.message = 'Operation failed. Original message'
```

## Constants

```typescript
import { ROOT_PROJECT_DIR } from 'fa-mcp-sdk';

const configPath = path.join(ROOT_PROJECT_DIR, 'config', 'default.yaml');
```

## General Utilities

```typescript
import { trim, isMainModule, isObject, isNonEmptyObject, ppj, encodeSvgForDataUri, getAsset } from 'fa-mcp-sdk';

trim('  hello  ');      // 'hello'
trim(null);             // ''
isMainModule(import.meta.url);  // true if main entry
isObject({});           // true
isObject([]);           // false
isNonEmptyObject({});   // false
isNonEmptyObject({ k: undefined }); // false
ppj({ user: 'john' });  // Pretty JSON string

const encoded = encodeSvgForDataUri(svgContent);
const logo = getAsset('logo.svg');  // From src/asset/
```

## HTTP Utilities

```typescript
import { normalizeHeaders } from 'fa-mcp-sdk';

// Normalizes to lowercase, joins arrays with ', '
const normalized = normalizeHeaders({
  'Authorization': 'Bearer token',
  'Accept-Language': ['en', 'ru']
});
// { 'authorization': 'Bearer token', 'accept-language': 'en, ru' }
```

## Tool Utilities

```typescript
import { getTools, formatToolResult, getJsonFromResult } from 'fa-mcp-sdk';

const tools = await getTools();  // Get registered tools

// Format based on appConfig.mcp.toolAnswerAs
const result = formatToolResult({ message: 'Done', data: {} });

// Extract original JSON from formatted result
const original = getJsonFromResult<MyType>(result);
```

## Network Utilities

```typescript
import { isPortAvailable, checkPortAvailability } from 'fa-mcp-sdk';

const available = await isPortAvailable(3000, 'localhost');

// Throws/exits if port busy
await checkPortAvailability(3000, 'localhost', true);
```

## Logging

```typescript
import { logger, fileLogger } from 'fa-mcp-sdk';

logger.info('Server started');
logger.warn('Warning');
logger.error('Error', error);

fileLogger.info('To file');
await fileLogger.asyncFinish();  // Flush before shutdown
```

## Event System

```typescript
import { eventEmitter } from 'fa-mcp-sdk';

eventEmitter.on('server:started', (data) => console.log(data));
eventEmitter.emit('custom:event', { data: 'example' });
```

## Consul Integration

```typescript
import { getConsulAPI, accessPointUpdater, deregisterServiceFromConsul } from 'fa-mcp-sdk';

const consul = await getConsulAPI();
const services = await consul.catalog.service.list();

accessPointUpdater.start();  // Auto-update access points
accessPointUpdater.stop();

await deregisterServiceFromConsul();
```

## Graceful Shutdown

```typescript
import { gracefulShutdown } from 'fa-mcp-sdk';

// Handles: Consul deregistration, DB close, log flush, etc.
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2', 0));

// SDK auto-registers SIGINT/SIGTERM handlers
```
