# Utilities, Errors, and Logging

## Error Classes

```typescript
import {
  BaseMcpError, ToolExecutionError, ValidationError, ServerError,
  // Phase 1 HTTP hardening — Appendix B specific errors:
  PayloadTooLargeError, TimeoutError, RateLimitedError, ResourceNotFoundError,
  MCP_ERROR_CODES, IMcpErrorData,
} from 'fa-mcp-sdk';

throw new ValidationError('Input validation failed');
throw new ToolExecutionError('my_tool', 'Execution failed');
throw new ServerError('Database connection failed', { key: 'value' });

// Standard §13 / Appendix B — already used by the SDK transport, but exported for tool / API code:
throw new PayloadTooLargeError('Image exceeds 1 MiB');                   // -32005 / 413
throw new TimeoutError('Upstream did not respond in time');               // -32004 / 504
throw new RateLimitedError('Too many calls', 30);                        // -32003 / 429 (retryAfter=30s)
throw new ResourceNotFoundError('Ticket not found', { field: 'key' });   // -32002 / 404

// Custom error — supply both the legacy string code and the JSON-RPC numeric code
class MyError extends BaseMcpError {
  constructor(msg: string) {
    super('MY_ERROR', msg, undefined, 422, undefined, -32600, { reason: 'my_reason' });
  }
}
```

| Class | `code` | `jsonRpcCode` | HTTP | Standard |
|-------|--------|---------------|------|----------|
| `ServerError` | `SERVER_ERROR` | `-32000` (default) | 500 | — |
| `ToolExecutionError` | `TOOL_EXECUTION_ERROR` | `-32000` (default) | 400 | — |
| `ValidationError` | `VALIDATION_ERROR` | `-32000` (default) | 400 | — |
| `ResourceNotFoundError` | `RESOURCE_NOT_FOUND` | `-32002` | 404 | Appendix B |
| `RateLimitedError` | `RATE_LIMITED` | `-32003` | 429 | Appendix B |
| `TimeoutError` | `TIMEOUT` | `-32004` | 504 | Appendix B |
| `PayloadTooLargeError` | `PAYLOAD_TOO_LARGE` | `-32005` | 413 | Appendix B |
| `UpstreamUnavailableError` | `UPSTREAM_UNAVAILABLE` | `-32006` | 503 | Appendix B |
| `ConflictError` | `CONFLICT` | `-32007` | 409 | Appendix B |

Two codes are narrower than they look, and reading them loosely sends debugging in the wrong direction:

- **`-32004` means Timeout and nothing else.** It is emitted when a tool call outruns
  `mcp.limits.toolTimeoutMs`. A call rejected because the token lacks a scope the tool requires is `-32000`
  with `error.data.reason: "insufficient_scope"`, `error.data.field: "scope"` and the missing scope names in
  `error.data.missing`.
- **`ResourceNotFoundError` is `-32002` toward legacy clients only.** The `2026-07-28` revision forbids that
  code, so the modern runtime reports "resource not found" as `-32602` with the same message and data. Throw the
  class as usual — the translation is applied per era on the way out.

### Protocol Codes of the Modern Era

The `2026-07-28` runtime rejects malformed requests before any handler is reached, with codes reserved by the
specification. No SDK error class maps to them, and project code MUST NOT allocate anything in `-32020…-32099`.

| Code | Name | HTTP | When |
|------|------|------|------|
| `-32020` | HeaderMismatch | 400 | A required request header is missing or contradicts the body (see "Streamable HTTP Troubleshooting" below). |
| `-32021` | MissingRequiredClientCapability | 400 | The request needs a client capability the client did not declare in its `_meta` envelope — for example a tool that asks for elicitation from a client that never announced it. |
| `-32022` | UnsupportedProtocolVersion | 400 | The revision named in the request is not served; `error.data` carries the list of supported revisions. |

### Mapping a Downstream API Status to a Typed Error

When a tool proxies a downstream HTTP API, translate the upstream status into one of these classes instead
of a single opaque `ServerError`. This gives the JSON-RPC layer a meaningful code and lets the surfacing
logic (next) decide whether the model should see the message. This is standard §13.4; the end-to-end
`normalizeToolError` / `isLlmVisibleError` / `formatToolError` pattern is in
[02-1-tools-and-api.md → "Normalizing upstream API errors"](./02-1-tools-and-api.md).

| Upstream HTTP                 | Throw                       | Surfaced to model as `isError`? |
|-------------------------------|-----------------------------|---------------------------------|
| 400                           | `ValidationError`           | yes                             |
| 401 / 403                     | `ServerError` (status in data) | yes                          |
| 404                           | `ResourceNotFoundError`     | yes                             |
| 409                           | `ConflictError`             | yes                             |
| 429                           | `RateLimitedError`          | no — thrown, keeps `retryAfter` |
| 502 / 503 / 504 / no response | `UpstreamUnavailableError`  | yes                             |
| other 5xx / unexpected        | `ServerError` (no status)   | no — thrown, sanitized          |

## Error Utilities

```typescript
import { createJsonRpcErrorResponse, toError, toStr, addErrorMessage } from 'fa-mcp-sdk';

// Create JSON-RPC error response. Optional third argument injects extra `error.data` keys
// (standard Appendix B.3 — { requestId?, field?, reason?, retryAfter?, … }).
const response = createJsonRpcErrorResponse(error, 'request-123', { requestId: 'req-abc' });

// Resulting body:
// { jsonrpc: '2.0', id: 'request-123',
//   error: { code: -32004, message: '…', data: { reason: 'tool_timeout', requestId: 'req-abc' } } }

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
  getTools, formatToolResult, formatToolError, getJsonFromResult,
  asTextContent, asTextError, asJson, asJsonError,
  TToolHandlerResponse, IToolHandlerTextResponse, IToolHandlerStructuredResponse,
} from 'fa-mcp-sdk';

const tools = await getTools();  // Get registered tools

// Format based on appConfig.mcp.tools.answerAs.
// Return type: TToolHandlerResponse<T> = IToolHandlerTextResponse | IToolHandlerStructuredResponse<T>
const result = formatToolResult<{ message: string; data: object }>({ message: 'Done', data: {} });

// Tool-level error — `isError: true` so the LLM sees it in conversation
// and can self-correct instead of treating it as a protocol failure.
const fail = formatToolError(`Issue ${key} not found`);

// Returns structuredContent or JSON from text depending on appConfig.mcp.tools.answerAs
const original = getJsonFromResult<T>(result);

// Direct formatting helpers (ignore tools.answerAs config):
asTextContent('Hello');            // { content: [{ type: 'text', text: 'Hello' }] }
asJson({ status: 'ok' });          // { structuredContent: { status: 'ok' } }
asTextError('Not found');          // { content: [{ type: 'text', text: 'Not found' }], isError: true }
asJsonError({ code: 'NOT_FOUND' }); // { structuredContent: { code: 'NOT_FOUND' },       isError: true }
```

### Return Type Signatures

```typescript
function formatToolResult<T = any>(json: T): TToolHandlerResponse<T>;
function formatToolError<T = any>(json: T): TToolHandlerResponse<T>;     // sets isError: true
function asTextContent(text: string): IToolHandlerTextResponse;
function asTextError(text: string): IToolHandlerTextResponse;            // sets isError: true
function asJson<T = any>(json: T): IToolHandlerStructuredResponse<T>;
function asJsonError<T = any>(json: T): IToolHandlerStructuredResponse<T>; // sets isError: true
function getJsonFromResult<T = any>(result: TToolHandlerResponse | any): T;
```

### When to Use Which

- **`formatToolResult()` / `formatToolError()`** — Primary choices in tool handlers. Respect
  `appConfig.mcp.tools.answerAs`. Use `formatToolError()` for *tool-level* failures (not found,
  validation, upstream 4xx) so the LLM sees them in conversation. See
  [02-1-tools-and-api.md → "Returning errors"](./02-1-tools-and-api.md) for the full guide.
- **`asTextContent()` / `asTextError()` / `asJson()` / `asJsonError()`** — Direct formatting,
  ignore `tools.answerAs`. Use when a specific shape is required.
- **`getJsonFromResult()`** — Inverse of `formatToolResult()`. Extracts JSON from either format. Use in tests.

## Multi Round-Trip Requests (`formatInputRequired`, `isInputRequiredResponse`)

A tool that needs a confirmation or a value the model did not supply pauses the call instead of guessing. Return
`formatInputRequired(...)` from the handler: the SDK turns it into a `resultType: "input_required"` result carrying
an HMAC-sealed `requestState`, the client collects the answers, and the same handler runs again with
`inputResponses` and `requestStatePayload` filled in. Configure the sealing secret and its lifetime through
`mcp.mrtr` — see [03-configuration → "Multi Round-Trip Requests"](./03-configuration.md).

```typescript
import {
  formatInputRequired, isInputRequiredResponse, formatToolResult, formatToolError, IToolHandlerParams,
} from 'fa-mcp-sdk';

export async function handler (params: IToolHandlerParams) {
  const answer = params.inputResponses?.confirm as { content?: { proceed?: boolean } } | undefined;

  if (!answer) {
    // First round: pause and ask. `state` is any JSON-serializable value you want back on retry.
    return formatInputRequired({
      inputRequests: {
        confirm: {
          method: 'elicitation/create',
          params: { message: `Delete ${params.arguments.id}?`, requestedSchema: confirmSchema },
        },
      },
      state: { id: params.arguments.id },
    });
  }

  // Second round: `requestStatePayload` is the verified `state` from above.
  const { id } = params.requestStatePayload as { id: string };
  return answer.content?.proceed ? formatToolResult(await remove(id)) : formatToolError('Cancelled by user');
}
```

`formatInputRequired` requires at least one of `inputRequests` / `state` and throws a `TypeError` otherwise. The
embedded request methods are `elicitation/create`, `sampling/createMessage` and `roots/list`; the SDK checks that
the client declared the matching capability and, when it did not, converts the pause into an actionable
`isError: true` text instead of sending a request the client cannot answer. Toward sessionful legacy clients the
marker degrades into that same `isError: true` text, so a tool written this way stays usable in both eras.

`isInputRequiredResponse(value)` is the type guard for the marker — useful in a dispatcher or in tests that wrap
handler results before returning them.

## Change Notifications (`mcpNotify`)

Modern clients receive catalog and resource change events over a `subscriptions/listen` stream rather than through
per-session notifications. `mcpNotify` publishes into that stream; call it whenever the server's surface changes.

```typescript
import { mcpNotify } from 'fa-mcp-sdk';

mcpNotify.toolsChanged();               // notifications/tools/list_changed
mcpNotify.promptsChanged();             // notifications/prompts/list_changed
mcpNotify.resourcesChanged();           // notifications/resources/list_changed
mcpNotify.resourceUpdated('db://orders/42');  // notifications/resources/updated for one URI
```

Each call fans out to every open listen subscription that opted in to that event. The legacy helper
`notifyResourceUpdated(server, uri)` routes into `mcpNotify` as well, so existing project code reaches modern
subscribers without changes.

## Client-Facing Log Messages (`log()`)

`IToolHandlerParams.log(level, data, logger?)` emits a `notifications/message` to the client that made the current
call — the MCP-level channel, separate from the server's own `logger`, which writes to console and files. It is
fire-and-forget: a delivery failure never breaks the tool call, and the call is a no-op when the client is not
listening, so call it unconditionally.

```typescript
export async function handler (params: IToolHandlerParams) {
  params.log?.('info', `Fetching ${params.arguments.symbol}`, `tool:${params.name}`);
  const rows = await fetchRows(params.arguments);
  params.log?.('debug', { rows: rows.length }, `tool:${params.name}`);
  return formatToolResult(rows);
}
```

`level` is the Syslog ladder (`TLoggingLevel`: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`,
`emergency`), `data` is any JSON-serializable value (truncated at `mcp.logging.maxBodyBytes`), and the optional
third argument tags the source so clients can route on it. The SDK applies the threshold: a modern request is
filtered by the level in its own `_meta.io.modelcontextprotocol/logLevel` — a request that omits the field receives
no log notifications at all — while a legacy session is filtered by the level its client set with
`logging/setLevel`.

## Masking Sensitive Data (`maskSensitive`, standard §12.2)

Masking personal / sensitive data in tool results is the **server's** responsibility — the SDK never
masks automatically (it does not know the domain model). `maskSensitive(value, rules)` is an optional,
reusable helper: call it inside a tool handler before returning the result.

```typescript
import { maskSensitive } from 'fa-mcp-sdk';

const result = await fetchUserRecord(args);
// Mask by field name (case-insensitive) and/or regex on string values at any depth.
const safe = maskSensitive(result, {
  fieldNames: ['password', 'token', 'ssn', 'emailAddress'],
  patterns: [/\b\d{13,19}\b/g],                 // card-like number sequences
  replacement: '***',                            // default; or a function for partial masking
});
return formatToolResult(safe);

// Partial masking via a replacement function:
maskSensitive({ card: '4111111111111111' }, {
  fieldNames: ['card'],
  replacement: (v) => `${v.slice(0, 4)}********${v.slice(-4)}`,  // → '4111********1111'
});
```

`IMaskRules`: `fieldNames?: string[]` (whole value of a matching key is replaced), `patterns?: RegExp[]`
(matches in string values are replaced; use a global flag to replace all in one string), `replacement?:
string | ((original: string) => string)` (default `'***'`). The input is never mutated; primitives pass
through unchanged. It is **not** wired into `tools/call` — applying it and choosing the rules stays with
the server.

> **Caveat.** Mask what genuinely must not leave the server (secrets, raw emails, account ids). Avoid
> blanket-masking display names the assistant actually needs to be useful (e.g. an issue's assignee) —
> that trades correctness for nothing. Pick field names deliberately.

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

Set `logger.disableMasking: true` in any YAML config — `maskValuesRegEx` becomes `[]` and nothing is
masked. Useful when you want raw payloads in dev logs.

```yaml
# config/local.yaml
logger:
  level: debug
  disableMasking: true   # log secrets/emails/URLs verbatim (DEV ONLY)
```

Or via env:

```bash
LOGGER_NO_MASK_VALUES=true yarn start
```

> ⚠️ Never enable `disableMasking` in production — emails, bearer tokens, and basic credentials will
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
    maskValuesRegEx: [],     // ad-hoc: drop all secret masking (same effect as logger.disableMasking)
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

## MCP Debug Output (`DEBUG=mcp:*`)

The SDK ships request/response tracing for every MCP channel as four independent debug switches
(built on `af-tools-ts` `Debug()` — same machinery as `DEBUG=token:auth`). Each category prints
the raw request and the raw response in human-readable form; turn them on selectively from the
shell or your `.env`.

| Env value                | What it prints                                                  |
|--------------------------|-----------------------------------------------------------------|
| `DEBUG=mcp:tool`         | `tools/call` — name + arguments in, response (text or JSON) out |
| `DEBUG=mcp:resource`     | `resources/list` and `resources/read` — URI in, body out        |
| `DEBUG=mcp:prompt`       | `prompts/list` and `prompts/get` — name/args in, messages out   |
| `DEBUG=mcp:notification` | All incoming `notifications/*` (method + params)                |
| `DEBUG=mcp:*`            | All four at once                                                |
| `DEBUG=*`                | Everything, including `token:auth` and any project debugs       |

Combine with commas: `DEBUG=mcp:tool,mcp:prompt yarn start`. The hooks live in the core MCP
dispatcher (see `init-mcp-server.ts` for the tool wrapper, `mcp/prompts.ts` and `mcp/resources.ts`
for the resource/prompt taps, and `web/server-http.ts` for the notification branch) — both HTTP and
STDIO transports route through them, so you get the same output regardless of how the client is
connected.

```bash
# One-off debug session
DEBUG=mcp:tool yarn start

# Trace everything an Agent Tester run does
DEBUG=mcp:* yarn start

# Persistent in .env
echo "DEBUG=mcp:tool,mcp:resource" >> .env
```

> ⚠️ STDIO transport reserves `stdout` for the JSON-RPC stream. The underlying `Debug()` writes to
> `stdout` via `console.log`, so enabling `DEBUG=mcp:*` in STDIO mode **will corrupt the framing**
> the client sees. Use these switches with HTTP/SSE transport, or redirect stdout.

## Streamable HTTP Troubleshooting

One `POST /mcp` endpoint serves both protocol eras, and the two have different admission rules. Read the failure
by era first — most "the client cannot talk to my server" reports are a header or a session problem, not a tool
problem.

**Modern requests (`2026-07-28`) are stateless and header-checked.** There is no `initialize`, no session, and no
`Mcp-Session-Id`; every request carries its own `_meta` envelope and must mirror its own body in the headers:

| Header | Required on | Must equal |
|--------|-------------|------------|
| `MCP-Protocol-Version` | every request | The protocol revision the client speaks, e.g. `2026-07-28` |
| `Mcp-Method` | every request | The JSON-RPC `method` in the body, e.g. `tools/call` |
| `Mcp-Name` | `tools/call`, `resources/read`, `prompts/get` | The target name in `params` — the tool name, the resource URI, or the prompt name |

A missing or contradicting header is rejected with HTTP **400** and JSON-RPC `-32020` (HeaderMismatch) before any
handler runs, so the tool never executes and the log carries no tool trace. An unserved revision in
`MCP-Protocol-Version` is HTTP **400** with `-32022` (UnsupportedProtocolVersion) and the supported list in
`error.data`. A request that needs a client capability the `_meta` envelope did not declare is HTTP **400** with
`-32021`.

```bash
curl -s http://localhost:9876/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' -H 'Mcp-Name: hello' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hello","arguments":{"name":"world"}}}'
```

**Sessions belong to the legacy era only.** A legacy client sends `initialize`, receives an `Mcp-Session-Id`, and
echoes it on every later request. When that id is unknown or expired — a restart, an eviction, a request routed to
a different replica — the server answers HTTP **404** with code `-32001` and the message
`Session not found: re-initialize to obtain a new session`, which tells the client to redo the handshake. Serving
such a request statelessly instead would silently drop the session-scoped state (subscriptions, log level), so the
404 is deliberate. If legacy clients see it constantly behind a load balancer, either pin their sessions to one
instance or move them to the modern era, which has no session state to lose.

`McpModernHttpClient` (see [07-testing-and-operations](07-testing-and-operations.md)) builds the modern headers and
envelope for you — reach for it before hand-rolling curl calls when checking a server end to end.

## HTTP Connection & RPC Tracing (`DEBUG=mcp-handshake`, `DEBUG=mcp-rpc`)

Separate from the `mcp:*` channel switches above, the **Streamable HTTP transport** carries its own
connection- and response-level tracing in `web/server-http.ts`. These switches use hyphenated names
(`mcp-handshake`, `mcp-rpc`) and are read straight from the comma-split `DEBUG` env var — they do
**not** go through the `af-tools-ts` `Debug()` machinery, so they are not covered by `mcp:*` or `*`.
List them explicitly, e.g. `DEBUG=mcp-handshake,mcp-rpc`. They exist to answer the two questions the
`mcp:*` taps cannot: *why did the client get a session/protocol error?* and *what did the server
actually send back?*

| Env value             | What it logs                                                                          |
|-----------------------|---------------------------------------------------------------------------------------|
| *(always on)*         | Legacy session created / closed / transport-closed (with active-session count); the unknown-session warning and the `-32600` "no valid session" rejection with its reason. |
| `DEBUG=mcp-handshake` | Per-request dump for every `/mcp` call: JSON-RPC method + id, short session id, routing hit/miss, protocol version, `Accept` / `Content-Type`, whether an auth header is present, and client IP. |
| `DEBUG=mcp-rpc`       | One-line summary of every **successful** JSON-RPC response (status, ids, `result=ok` / notifications). |

Two things always log regardless of the switches, because they are otherwise silent failure modes:

- **Legacy session rejections.** A legacy client that presents an unknown or expired `mcp-session-id`
  gets a logged warning with the count of still-known sessions, and the `-32600` rejections raised
  inside the legacy transport are logged with the reason (the client must send `initialize` first or
  echo a valid session id). These lines are what to look for when a legacy client reports a session
  error and the rest of the log is silent. Modern requests never open a session and never reach this
  branch.
- **Every JSON-RPC error response.** A response tee on `POST /mcp` and the `GET`/`DELETE` session
  routes captures the outgoing body, parses it (auto-detecting a plain `application/json` answer vs.
  the `data:` frames of an SSE stream), and logs each error's HTTP status, request id, `code`,
  `message`, and truncated `data`, together with the originating request summary. The capture is
  capped at 256 KB per response so a long SSE stream cannot exhaust memory (`[capture truncated]`
  marks a hit), and the trace is wrapped so it can never break the real response.

```bash
# Why is the client getting "no valid session" / -32600? (handshake dump on every request)
DEBUG=mcp-handshake yarn start

# Also summarise successful responses (otherwise only errors are logged)
DEBUG=mcp-handshake,mcp-rpc yarn start
```

> These switches are HTTP-transport only — STDIO never opens sessions, so they have no effect there.
> They are safe to leave off in production; the always-on session-lifecycle and error lines are the
> ones worth keeping in normal operation.

### Extending with Custom Debug Categories

Add your own switches with the same `Debug()` helper from `af-tools-ts`:

```typescript
// src/lib/debug.ts
import { Debug } from 'af-tools-ts';
import { red, lBlue } from 'af-color';

export const debugExternalApi = Debug('myapp:external-api', {
  prefixColor: red,
  messageColor: lBlue,
});
```

```typescript
// inside any handler / client
import { debugExternalApi } from '../lib/debug.js';

if (debugExternalApi.enabled) {
  debugExternalApi(`POST ${url}\n${JSON.stringify(body, null, 2)}`);
}
```

Enable with `DEBUG=myapp:external-api`. The `.enabled` guard avoids the JSON-stringify cost when
the category is off. The four built-in `debugMcpTool`/`debugMcpResource`/`debugMcpPrompt`/
`debugMcpNotification` instances are re-exported from `fa-mcp-sdk` if you want to piggyback on
them from your own code (e.g. emit a custom line inside `handle-tool-call.ts` whenever
`debugMcpTool.enabled` is true).

## JSON-lines Sink (`mcp.debug.logFile`)

`DEBUG=mcp:*` writes ANSI-coloured human-readable text to stderr — perfect for live development,
useless for post-mortem (colours, interleaved process output, no structured fields). Set
`mcp.debug.logFile` to an absolute path and the SDK additionally mirrors every `mcp:tool`,
`mcp:resource`, `mcp:prompt` event as one JSON object per line. The stderr stream is unchanged —
the sink is purely additive.

```yaml
# config/default.yaml — or any environment override
mcp:
  debug:
    logFile: /var/log/mcp/server-debug.jsonl   # absolute path; parent dir is created on first event
    builtinTools: false                         # see next section
```

Or via env (mapped through `config/custom-environment-variables.yaml`):

```bash
MCP_DEBUG_LOG_FILE=/var/log/mcp/server.jsonl yarn start
```

### Event Shape

Each line is a self-contained JSON object. `ts` (ISO timestamp) and `ch` (channel) are always
present; remaining fields depend on the channel and `kind`.

```jsonl
{"ts":"2026-05-19T12:34:56.124Z","ch":"mcp:tool","kind":"req","name":"get_rate","args":{"from":"EUR"},"corr":"a3f1c0d2"}
{"ts":"2026-05-19T12:34:56.171Z","ch":"mcp:tool","kind":"res","name":"get_rate","ms":47,"corr":"a3f1c0d2","ok":true}
{"ts":"2026-05-19T12:34:57.012Z","ch":"mcp:tool","kind":"err","name":"get_rate","ms":2998,"corr":"b9c20f3a","error":"Connection timeout"}
{"ts":"2026-05-19T12:34:57.045Z","ch":"mcp:resource","kind":"read-res","uri":"ui://weather/view.html","ms":3}
{"ts":"2026-05-19T12:34:57.090Z","ch":"mcp:prompt","kind":"get-res","name":"agent_prompt","ms":1}
```

| Channel         | `kind` values                                                  | Useful fields                |
|-----------------|----------------------------------------------------------------|------------------------------|
| `mcp:tool`      | `req` / `res` / `err`                                          | `name`, `args`, `ms`, `corr` |
| `mcp:resource`  | `list-req` / `list-res` / `read-req` / `read-res` / `read-err` | `uri`, `count`, `ms`         |
| `mcp:prompt`    | `list-req` / `list-res` / `get-req` / `get-res` / `get-err`    | `name`, `count`, `ms`        |
| `app:view-log`  | `log` (emitted by built-in `mcp-debug-log` tool)               | `type`, `payload`            |

`corr` is an 8-char hex correlation ID — pair `req` ↔ `res`/`err` for one tool call.

### Working With The File

Standard JSON toolchain works as-is:

```bash
# p95 latency by tool
jq -r 'select(.ch=="mcp:tool" and .kind=="res") | "\(.name)\t\(.ms)"' /var/log/mcp/*.jsonl \
  | sort | datamash -g 1 perc:95 2

# all errors of the last hour
jq 'select((.kind|test("err$")) and (.ts > "2026-05-19T11:00:00"))' /var/log/mcp/*.jsonl

# events pushed by widgets via mcp-debug-log
jq 'select(.ch=="app:view-log")' /var/log/mcp/*.jsonl
```

### Programmatic Access

If you need to write into the same channel from your own code (e.g. tag a domain event so it shows
up alongside MCP traffic), use the helpers directly:

```typescript
import { emitTrace, configureDebugSink } from 'fa-mcp-sdk';

// At startup the SDK already calls configureDebugSink(appConfig.mcp.debug.logFile);
// re-configure on the fly only in tests.
configureDebugSink('/tmp/mcp-test.jsonl');

emitTrace('app:billing', { kind: 'charge', userId, amountCents });
// → {"ts":"…","ch":"app:billing","kind":"charge","userId":"…","amountCents":1299}
```

`emitTrace` is a no-op when no sink is configured — the guard is cheap, leave the calls in.

## Built-in Debug Tools (`mcp.debug.builtinTools`)

A single flag registers three SDK-provided tools that exist to be called from widget code or
integration tests, never by the LLM. All three are marked `_meta.ui.visibility: ['app']`, so MCP App
hosts (Agent Tester, Claude Desktop with apps support, etc.) hide them from the agent's tool list.

```yaml
mcp:
  debug:
    builtinTools: true     # or MCP_DEBUG_BUILTIN_TOOLS=true
```

| Tool name           | Caller         | Purpose                                                                     |
|---------------------|----------------|-----------------------------------------------------------------------------|
| `mcp-debug-log`     | Widget         | Push a structured event into the same channel as `DEBUG=mcp:*` / JSON-lines |
| `mcp-debug-refresh` | Widget         | Read back lightweight server state (timestamp + counter) without the LLM    |
| `debug-tool`        | Test client    | Universal CallToolResult fixture — see [07-testing-and-operations](07-testing-and-operations.md) → "Universal `debug-tool` for Integration Tests" |

The widget-facing tools are covered in [10-mcp-apps](10-mcp-apps.md) → "Widget-side debug helpers"
(the canonical example calls them through `app.callServerTool(...)`). Names and constants are
exported when you need to reference them in test code:

```typescript
import {
  MCP_DEBUG_LOG_TOOL_NAME,       // 'mcp-debug-log'
  MCP_DEBUG_REFRESH_TOOL_NAME,   // 'mcp-debug-refresh'
  DEBUG_TOOL_NAME,               // 'debug-tool'
  BUILTIN_MCP_DEBUG_TOOLS,       // Tool[] descriptors for the two widget tools
  DEBUG_TOOL,                    // Tool descriptor for the test fixture
} from 'fa-mcp-sdk';
```

> Leave `builtinTools: false` in production unless a widget genuinely needs `mcp-debug-log` /
> `mcp-debug-refresh` at runtime. The tools are inert to the LLM, but they still occupy space in the
> `tools/list` payload and add a small amount of routing overhead per call.

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
