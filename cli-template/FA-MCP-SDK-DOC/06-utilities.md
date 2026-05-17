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
import {
  getTools, formatToolResult, getJsonFromResult, asTextContent, asJson,
  TToolHandlerResponse, IToolHandlerTextResponse, IToolHandlerStructuredResponse,
} from 'fa-mcp-sdk';

const tools = await getTools();  // Get registered tools

// Format based on appConfig.mcp.tools.answerAs.
// Return type: TToolHandlerResponse<T> = IToolHandlerTextResponse | IToolHandlerStructuredResponse<T>
const result = formatToolResult<{ message: string; data: object }>({ message: 'Done', data: {} });

// Returns structuredContent or JSON from text depending on appConfig.mcp.tools.answerAs
const original = getJsonFromResult<T>(result);

// Direct formatting helpers (ignore tools.answerAs config):
asTextContent('Hello');           // IToolHandlerTextResponse: { content: [{ type: 'text', text: 'Hello' }] }
asJson({ status: 'ok' });         // IToolHandlerStructuredResponse: { structuredContent: { status: 'ok' } }
```

### Return Type Signatures

```typescript
function formatToolResult<T = any>(json: T): TToolHandlerResponse<T>;
function asTextContent(text: string): IToolHandlerTextResponse;
function asJson<T = any>(json: T): IToolHandlerStructuredResponse<T>;
function getJsonFromResult<T = any>(result: TToolHandlerResponse | any): T;
```

### When to Use Which

- **`formatToolResult()`** — Primary choice in tool handlers. Respects `appConfig.mcp.tools.answerAs` config.
- **`asTextContent()` / `asJson()`** — Direct formatting, ignores `tools.answerAs`. Use when specific format needed.
- **`getJsonFromResult()`** — Inverse of `formatToolResult()`. Extracts JSON from either format. Use in tests.

## Network Utilities

```typescript
import { isPortAvailable, checkPortAvailability } from 'fa-mcp-sdk';

const available = await isPortAvailable(3000, 'localhost');

// Throws/exits if port busy
await checkPortAvailability(3000, 'localhost', true);
```

## Logging

```typescript
import { logger, fileLogger, Logger } from 'fa-mcp-sdk';

logger.info('Server started');
logger.warn('Warning');
logger.error('Error', error);

fileLogger.info('To file');
await fileLogger.asyncFinish();  // Flush before shutdown

// Logger type for typing custom logger references
const myLogger: Logger = logger;

// Named sublogger — pick this up anywhere in your code
const subLogger = logger.getSubLogger({ name: 'payments' });
subLogger.info('Charge captured');
```

**`Logger`** — The logger type from 'af-logger-ts' is used to type variables and function parameters.

### Built-in Defaults

The SDK initializes `af-logger-ts` with these defaults:

- `level` — from `config.logger.level` (in STDIO transport it is forced to `error` and console output
  is redirected to `stderr` to keep stdout clean for the JSON-RPC stream).
- `filePrefix` — from `appConfig.name`.
- File logger — enabled when `config.logger.useFileLogger: true`, writes to `config.logger.dir`.
- `maskValuesRegEx` — a built-in list that masks tokens, API keys, secrets, passwords,
  `Authorization` headers (Basic/Bearer), email addresses, and HTTP-URL credentials.

### Disabling the Built-in Secret Masking

Set `logger.noMaskValues: true` in any YAML config — `maskValuesRegEx` becomes `[]` and nothing is
masked. Useful when you want raw payloads in dev logs.

```yaml
# config/local.yaml
logger:
  level: debug
  noMaskValues: true   # log secrets/emails/URLs verbatim (DEV ONLY)
```

Or via env:

```bash
LOGGER_NO_MASK_VALUES=true yarn start
```

> ⚠️ Never enable `noMaskValues` in production — emails, bearer tokens, and basic credentials will
> leak into log files and console output.

### Overriding Logger Settings at Startup

Pass `loggerSettings: Partial<ILoggerSettings>` in `McpServerData` to override individual fields
on top of the built-in defaults. The merge is shallow — only the fields you specify are replaced;
everything else (`prettyLogTemplate`, `filePrefix`, `maskValuesRegEx`, file-logger config, etc.) is
kept.

```typescript
// src/start.ts
import { initMcpServer, McpServerData } from 'fa-mcp-sdk';

const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  // ...

  loggerSettings: {
    level: 'silly',          // bump verbosity for one run without touching YAML
    maskValuesRegEx: [],     // ad-hoc: drop all secret masking (same effect as logger.noMaskValues)
  },
};

await initMcpServer(serverData);
```

`initMcpServer` applies these overrides before any further logging. Existing top-level
`const logger = lgr.getSubLogger(...)` bindings transparently pick up the new settings on next
use — no need to re-import.

### Reapplying Settings After Startup

`applyLoggerSettings(overrides)` is also exported directly. Call it whenever you want to change
logger configuration on the fly (e.g. raise verbosity from an admin endpoint). The cached main
logger and the sub-logger cache are reset, so subsequent log calls pick up the new settings
immediately.

```typescript
import { applyLoggerSettings } from 'fa-mcp-sdk';

// Temporarily switch to silly-level logging for a debugging window
applyLoggerSettings({ level: 'silly' });

// Restore later
applyLoggerSettings({ level: 'info' });
```

> Note: in STDIO transport the logger is a stub (writes to `stderr`) and `applyLoggerSettings` is a
> no-op — `console.log` etc. would otherwise corrupt the JSON-RPC framing on stdout.

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

// accessPointUpdater is started/stopped by the SDK automatically — see 03-configuration.md → "Access Points".
// The start()/stop() hooks below are exposed only for tests and diagnostics.
accessPointUpdater.start();
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
