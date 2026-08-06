# Testing and Operations

## Protocol Eras

The server serves two protocol generations on the same endpoints, so every test client belongs to one of
two families. Pick the family that matches what you want to exercise — and, for anything that ships to
real clients, exercise both.

| Era        | Revision(s)              | Shape                                                       | Clients                                              |
|------------|--------------------------|-------------------------------------------------------------|------------------------------------------------------|
| **modern** | `2026-07-28`             | Stateless, no `initialize`, per-request `_meta` envelope      | `McpModernHttpClient`, `McpStdioClient` with `{ modern: true }` |
| **legacy** | `2025-11-25` and earlier | `initialize` handshake plus an `Mcp-Session-Id` session       | `McpStreamableHttpClient`, `McpSseClient`, `McpHttpClient`, `McpStdioClient` |

Details of the wire contract are in [11-public-contract](11-public-contract.md) §1.

## Test Clients

### Modern HTTP Transport (MCP 2026-07-28)

`McpModernHttpClient` wraps the official `@modelcontextprotocol/client` v2 package, so a test that uses it
also exercises the reference client implementation against your server. There is no handshake: the
transport puts the required `_meta` envelope and the `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name`
headers on every POST, and nothing is shared between requests.

```typescript
import { McpModernHttpClient } from 'fa-mcp-sdk';

const client = new McpModernHttpClient('http://localhost:9876', {
  headers: { Authorization: 'Bearer token' },
  clientInfo: { name: 'my-test', version: '1.0.0' },
  // Advertised on every request — declare what the server may ask of you.
  clientCapabilities: { elicitation: { form: {} } },
});

// No initialize(). `server/discover` is the one call that describes the server.
const info = await client.discover();
console.log(info.supportedVersions);                              // ['2026-07-28']
console.log(info._meta['io.modelcontextprotocol/serverInfo']);    // { name, version }
console.log(info.ttlMs, info.cacheScope);                         // cache hints
console.log(client.protocolEra);                                  // 'modern'

const result = await client.callTool('my_tool', { query: 'test' });
const prompt = await client.getPrompt('agent_brief');
const resources = await client.listResources();
const content = await client.readResource('custom://data');

await client.close();
```

**Constructor:** `new McpModernHttpClient(baseURL, options?)` with
`{ endpointPath?, headers?, requestTimeoutMs?, clientInfo?, clientCapabilities? }` — `endpointPath`
defaults to `/mcp`, `requestTimeoutMs` to 120000.

**Methods:** `discover`, `listTools`, `callTool`, `listResources`, `readResource`, `listPrompts`,
`getPrompt`, `listen`, `callToolWithInput`, `close`. Getter `protocolEra` reports the era the client
settled on once a request has run.

> The reference v2 client negotiates the **legacy** era by default. `McpModernHttpClient` pins
> `2026-07-28`, which is what makes it speak the modern protocol — no handshake, per-request `_meta`.

**Subscriptions.** `listen(filter)` opens a `subscriptions/listen` stream. The filter is opt-in, so name
every notification type you want — `toolsListChanged`, `promptsListChanged`, `resourcesListChanged` and
`resourceSubscriptions` (a list of resource URIs); nothing else is delivered. The call resolves once the
server's `notifications/subscriptions/acknowledged` arrives, and the returned subscription exposes
`honoredFilter` (the subset the server agreed to), `close()` and `closed`.

```typescript
const sub = await client.listen({ toolsListChanged: true, resourceSubscriptions: ['custom://data'] });
console.log(sub.honoredFilter);       // what the server actually accepted
// …exercise the server so it publishes a change…
await sub.close();                    // unsubscribes; `sub.closed` resolves with 'local'
```

Notifications arriving on the stream are dispatched to the notification handlers registered on the
underlying reference client — the same handlers a legacy connection fires — so the server side is driven
by the exported `mcpNotify` facade (`toolsChanged()`, `promptsChanged()`, `resourcesChanged()`,
`resourceUpdated(uri)`), and every message carries `_meta["io.modelcontextprotocol/subscriptionId"]` for
correlation.

**Multi round-trip calls.** `callToolWithInput()` drives the whole MRTR loop for you: when the server
answers `resultType: "input_required"`, your callback supplies the answers and the call is retried with
them plus the echoed `requestState`, until a final result arrives.

```typescript
const result = await client.callToolWithInput(
  'example_confirm',
  { action: 'delete everything' },
  // `requests` are the server's inputRequests, keyed by server-assigned id.
  (requests) => Object.fromEntries(
    Object.keys(requests).map((id) => [id, { action: 'accept', content: { confirmed: true } }]),
  ),
);
```

### STDIO Transport

STDIO is dual-era as well: the server decides the era from the connection's **opening message** and pins
it for the process lifetime. `{ modern: true }` makes the client's first message carry the modern
envelope, which selects the modern path; the default (no option) opens with `initialize` and selects the
legacy path.

```typescript
import { McpStdioClient } from 'fa-mcp-sdk';
import { spawn } from 'child_process';

const proc = spawn('node', ['dist/start.js', 'stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'test' },
});

const legacy = new McpStdioClient(proc);                    // legacy era — initialize handshake
const modern = new McpStdioClient(proc, { modern: true });  // modern era — per-request `_meta`

const result = await legacy.callTool('my_tool', { query: 'test' });
const prompt = await legacy.getPrompt('agent_brief');
```

### HTTP Transport (legacy)

> **Deprecated:** `McpHttpClient` is a thin alias of `McpStreamableHttpClient` (see below). The server's
> `/mcp` endpoint serves legacy sessions through the SDK `StreamableHTTPServerTransport`, so the old
> plain-POST client no longer applies — both names speak the same Streamable HTTP protocol. Prefer
> `McpStreamableHttpClient` in new legacy-era code and `McpModernHttpClient` in new code generally.

```typescript
import { McpHttpClient } from 'fa-mcp-sdk';

// Auth headers go in the constructor (not as a per-call argument).
const client = new McpHttpClient('http://localhost:3000', {
  headers: { Authorization: 'Bearer token' },
});
await client.initialize();
const result = await client.callTool('my_tool', { query: 'test' });
```

### SSE Transport (legacy)

```typescript
import { McpSseClient } from 'fa-mcp-sdk';

const client = new McpSseClient('http://localhost:3000');
const result = await client.callTool('my_tool', { query: 'test' });
```

### Streamable HTTP (legacy, MCP 2025-11-25)

Wraps the official `@modelcontextprotocol/sdk` v1 `Client` + `StreamableHTTPClientTransport`. The SDK
transport sets `Accept: application/json, text/event-stream`, captures and resends `Mcp-Session-Id`,
negotiates the protocol version, and sends `DELETE /mcp` on `close()`.

```typescript
import { McpStreamableHttpClient } from 'fa-mcp-sdk';

const client = new McpStreamableHttpClient('http://localhost:3000', {
  headers: { Authorization: 'Bearer token' },
  requestTimeoutMs: 60000,
});

// `initialize()` runs the full handshake; the server answers the negotiated version (2025-11-25).
await client.initialize();

const result = await client.callTool('my_tool', { query: 'test' });
const prompt = await client.getPrompt('agent_brief');
const resources = await client.listResources();
const content = await client.readResource('custom://data');

await client.close();
```

**Methods:** `initialize`, `close`, `callTool`, `getPrompt`, `listResources`, `readResource`,
`listTools`, `listPrompts`, `discover`. After `initialize()`, `client.serverInfo`, `client.capabilities`
and `client.protocolVersion` are populated. `discover()` and the modern `_meta` envelope come from the
shared `BaseMcpClient`, so any client can probe `server/discover`.

## Transport Types

| Transport | Config | Use Case |
|-----------|--------|----------|
| STDIO | `mcp.transportType: "stdio"` | CLI, local dev, Claude Desktop |
| HTTP (Streamable HTTP) | `mcp.transportType: "http"` | Web integrations, REST API — serves both eras |
| SSE (Deprecated HTTP+SSE) | HTTP transport | Long-running ops, streaming; older clients |

`POST /mcp` decides the era per request; `GET` and `DELETE` serve legacy sessions only:

| Method `/mcp` | Behaviour |
|---------------|-----------|
| `POST` | A known `Mcp-Session-Id` routes to that legacy session; an unknown or expired one (on a non-`initialize` request) gets **404** + `-32001`; `initialize` opens a new legacy session; everything else is served statelessly as modern traffic. Notifications → **202** with an empty body. |
| `GET` | Server→client SSE stream for a legacy session. Modern clients use `subscriptions/listen` instead. |
| `DELETE` | Tears down a legacy session. Modern clients have no session to tear down. |

## Running Tests

### Project tests

```bash
npm test                               # All tests (Jest)
npx jest tests/path/file.test.ts       # Single file
npx jest --testNamePattern="pattern"   # Filter by test name
```

### Manual transport scripts

These run against a server that is **already up** (`npm run build && npm start` first) and walk the shared
cases in `tests/mcp/test-cases.js` — the file to edit when you add a tool. Each script prints a per-case
pass/fail list and exits non-zero on failure.

```bash
node tests/mcp/test-http-modern.js   # modern era (2026-07-28) via McpModernHttpClient
node tests/mcp/test-http.js          # legacy era — Streamable HTTP
node tests/mcp/test-sse.js           # legacy era — Deprecated HTTP+SSE transport
node tests/mcp/test-stdio.js         # legacy era — STDIO (spawns its own process)
```

`test-http-modern.js` starts by printing the `server/discover` answer — supported versions, capability
names, `serverInfo`, cache hints and the negotiated era — which makes it the fastest way to confirm that
a deployment really is serving the modern protocol.

### SDK protocol suites

The `fa-mcp-sdk` repository itself carries protocol-level suites written for Node's built-in test runner
(no Jest). Each one spawns a server, drives it, and exits non-zero on failure; run any of them with
`node tests/<name>.test.mjs` after `npm run build`.

| Suite | What it pins down |
|-------|-------------------|
| `modern-discover` | `server/discover` shape, catalog and tool calls over the stateless handler |
| `modern-headers` | `Mcp-Method` / `Mcp-Name` agreement (`-32020`), unsupported version (`-32022`), the Base64 sentinel |
| `modern-meta` | `_meta` envelope validation (`-32602`), unknown method (`-32601`), notifications → 202 |
| `modern-cache-hints` | `ttlMs` / `cacheScope` on every cacheable result, deterministic `tools/list` order |
| `modern-subscriptions` | `subscriptions/listen` acknowledgment, opt-in filtering, `subscriptionId` correlation |
| `modern-mrtr` | `formatInputRequired` round trip, `requestState` tampering, missing client capability |
| `modern-tasks` | The `io.modelcontextprotocol/tasks` extension — advertisement, `tasks/get`, `tasks/update`, `tasks/cancel` |
| `modern-stdio` | Dual-era STDIO: the opening message decides the era and pins it |
| `modern-observability` | Per-request log level and `progressToken`-gated progress on the request's own stream |
| `dual-era` | Both official reference clients driving one endpoint at the same time, interleaved |
| `template-examples` | The template's 2026-07-28 example tools against a live server |

Alongside them sit the pre-existing suites — `jwt`, `jwt-v2`, `ip-check`, `capabilities`, `completions`,
`error-codes`, `error-sanitize`, `binary-resource`, `deprecation`, `metrics`, `request-id`, `scope-error`,
`sse-resumability`, `tasks-lifecycle`, `tasks-cancel`, `tasks-capability`, `tasks-progress`,
`mask-sensitive`, `oauth-endpoints`, `prompt-resource-metadata`, `agent-tester-auth-modes`,
`agent-tester-ttl-refresh` — run the same way.

### Auth Headers for Tests

```typescript
import { getAuthHeadersForTests } from 'fa-mcp-sdk';

const headers = getAuthHeadersForTests(); // Uses config auth settings
const result = await client.callTool('my_tool', { query: 'test' }, headers);
```

### What to Test

- **Happy path** — tool returns expected result for valid input
- **Error cases** — invalid params, missing required fields, service errors
- **Auth flows** — authenticated vs unauthenticated, different auth methods
- **Transport parity** — same behavior across STDIO, HTTP, SSE
- **Era parity** — the same tool, prompt and resource answers for a modern and a legacy client
- **Modern envelope** — the call still works when the client declares no optional capabilities
- **Edge cases** — empty strings, large payloads, special characters

## Universal `debug-tool` for Integration Tests

When the system-under-test is a **client** (Agent Tester, custom MCP host, CI smoke test) rather
than the server, you usually need a server that produces every kind of `CallToolResult` on demand —
text, image, audio, embedded resources, mixed blocks, `isError: true`, slow responses, large
payloads. The SDK ships a single parameterised fixture so test code never has to roll its own
fake server.

Enable it together with the other built-ins ([06-utilities](06-utilities.md) → "Built-in Debug
Tools"):

```yaml
mcp:
  debug:
    builtinTools: true
```

This appends a tool named `debug-tool` to the server's `tools/list`, hidden from the LLM via
`_meta.ui.visibility: ['app']`.

### Input Schema

| Argument                   | Type / values                                                 | Default | Purpose                              |
|----------------------------|---------------------------------------------------------------|---------|--------------------------------------|
| `contentType`              | `text` \| `image` \| `audio` \| `resource` \| `resourceLink` \| `mixed` | `text`  | Which content-block type to emit. `mixed` returns one of each (ignores `multipleBlocks`) |
| `multipleBlocks`           | `boolean`                                                     | `true`  | Emit 3 blocks of the chosen type vs. 1 |
| `includeStructuredContent` | `boolean`                                                     | `true`  | Include `result.structuredContent` with `{ config, timestamp, counter, largeInputLength? }` |
| `includeMeta`              | `boolean`                                                     | `true`  | Include `result._meta.debugInfo`     |
| `simulateError`            | `boolean`                                                     | `false` | Set `result.isError = true` (call still resolves) |
| `delayMs`                  | `number` ≥ 0                                                  | none    | Artificial latency for timeout / loading-state tests |
| `largeInput`               | `string`                                                      | none    | Large payload — echoed back as `structuredContent.largeInputLength` |

### Example: Single Server, Every Variation

```typescript
// tests/agent-tester/content-types.test.ts
import { McpHttpClient } from 'fa-mcp-sdk';

const client = new McpHttpClient('http://localhost:9876');

test('renders mixed text + image + audio', async () => {
  const result = await client.callTool('debug-tool', { contentType: 'mixed' });
  expect(result.content).toHaveLength(3);
  expect(result.content.map((b: any) => b.type)).toEqual(['text', 'image', 'audio']);
});

test('isError: true is surfaced', async () => {
  const result = await client.callTool('debug-tool', {
    contentType: 'text',
    simulateError: true,
  });
  expect((result as any).isError).toBe(true);
});

test('respects delayMs for loading-state tests', async () => {
  const t0 = Date.now();
  await client.callTool('debug-tool', { contentType: 'text', delayMs: 800 });
  expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
});

test('large payload survives the round trip', async () => {
  const big = 'x'.repeat(200_000);
  const result = await client.callTool('debug-tool', { contentType: 'text', largeInput: big });
  expect((result as any).structuredContent.largeInputLength).toBe(200_000);
});
```

### Standalone Test Server

If you need a throw-away server outside `initMcpServer` (e.g. spinning up a bare
`@modelcontextprotocol/sdk` `McpServer` for an in-process test), use `registerDebugTool` directly:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDebugTool, DEBUG_TOOL_NAME } from 'fa-mcp-sdk';

const server = new McpServer({ name: 'test-fixture', version: '0.0.0' });
registerDebugTool(server);
// → callTool(DEBUG_TOOL_NAME, { contentType: 'mixed' }) works against this server.
```

The helper accepts any object with `registerTool(name, def, handler)` — structurally compatible
with the high-level SDK API — so the SDK does not pull in a hard dependency on
`@modelcontextprotocol/sdk/server/mcp.js`.

## Best Practices

### Project Organization
- One responsibility per tool
- Use TypeScript throughout
- Separate configs for dev/prod

### Tool Development
- Validate all inputs
- Use `formatToolResult()` for responses
- Use error classes for failures
- Log operations with `logger`

### Testing
- Test all transport types, and both protocol eras on each of them
- Include error cases
- Use provided test clients — they wrap the official reference clients of both generations

### Security
- Environment variables for secrets
- Enable auth for production
- Validate all user inputs
- Don't leak sensitive info in errors
