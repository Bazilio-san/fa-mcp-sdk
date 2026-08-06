# Configuration, Cache, and Access Points

## Custom Startup Diagnostics

You can add custom key-value pairs to the startup diagnostic output by passing `customStartupInfo` to `McpServerData`:

```typescript
const serverData: McpServerData = {
  // ... other options

  // Custom startup diagnostic info displayed in the console at server start
  customStartupInfo: [
    ['Custom param', 'any value'],
    ['Environment', process.env.MY_ENV || 'default'],
    ['Feature Flag', isFeatureEnabled ? 'enabled' : 'disabled'],
  ],
};
```

These values will appear in the startup info block alongside built-in diagnostics like `MCP Auth`, `Admin Auth`, etc.

## Configuration

### appConfig Access

```typescript
import { appConfig } from 'fa-mcp-sdk';

const port = appConfig.webServer.port;
const dbEnabled = appConfig.isMainDBUsed;
const transport = appConfig.mcp.transportType; // 'stdio' | 'http'
```

### Service Identification

| Variable | Source | Usage |
|----------|--------|-------|
| `appConfig.name` | `SERVICE_NAME` env or `package.json.name` | Consul, JWT, logs, MCP server ID |
| `appConfig.shortName` | name without "mcp" | Cache key prefix |
| `appConfig.productName` | `PRODUCT_NAME` env or `package.json.productName` | Swagger title, UI header |

### config/default.yaml

```yaml
accessPoints:
  myService:
    title: 'Remote service'
    host: <host>
    port: 9999
    token: '***'
    noConsul: true
    consulServiceName: <name>

cache:
  ttlSeconds: 300
  maxItems: 1000

consul:
  check:
    interval: '10s'
    timeout: '5s'
    deregistercriticalserviceafter: '3m'
  agent:
    dev:                                # DEV DC credentials
      dc: '{{consul.agent.dev.dc}}'
      host: '{{consul.agent.dev.host}}'
      port: 443
      secure: true
      token: '***'
    prd:                                # PROD DC credentials
      dc: '{{consul.agent.prd.dc}}'
      host: '{{consul.agent.prd.host}}'
      port: 443
      secure: true
      token: '***'
    reg:                                # Service registration
      host: null                        # null = use current server
      port: 8500
      secure: false
      token: '***'
  service:
    enable: {{consul.service.enable}}
    name: <name>                        # from package.json
    instance: '{{SERVICE_INSTANCE}}'
    version: <version>                  # from package.json
    description: <description>          # from package.json
    tags: []                            # null/empty = from package.keywords
    meta:
      who: 'http://{address}:{port}/'
  envCode:
    prod: {{consul.envCode.prod}}
    dev: {{consul.envCode.dev}}

db:
  postgres:
    dbs:
      main:
        label: 'My Database'
        host: ''  # Empty = DB disabled
        port: 5432
        database: <database>
        user: <user>
        password: <password>

logger:
  level: info
  useFileLogger: {{logger.useFileLogger}}
  dir: '{{logger.dir}}'
  disableMasking: false   # true — disable built-in secret/email/URL masking (maskValuesRegEx = [])

mcp:
  transportType: http  # stdio | http
  rateLimit:
    maxRequests: 100
    windowMs: 60000
    # Standard §14 — 'subject' counts per JWT `sub`/`user` with IP fallback; 'ip' = legacy.
    scope: subject
    # Max in-flight tools/call per subject. Excess → -32003 / HTTP 429 + Retry-After.
    maxConcurrentPerSubject: 16
  # Hard ceilings enforced by the HTTP transport (standard §14). Concrete servers MAY raise
  # or lower these per-environment without patching the SDK.
  limits:
    # Max accepted JSON / urlencoded request body, bytes. Above the limit:
    # JSON-RPC code -32005, HTTP 413 Payload Too Large.
    maxPayloadBytes: 1048576       # 1 MiB
    # Max serialized tool result, bytes. Above the limit, the SDK truncates the payload
    # and marks `structuredContent.truncated: true` + appends "…[truncated]" to text content.
    maxToolResultBytes: 10485760   # 10 MiB
    # Per-tool execution timeout, milliseconds. Above the limit:
    # JSON-RPC code -32004, HTTP 504 Gateway Timeout.
    toolTimeoutMs: 30000           # 30 seconds
  tools:
    # text | structuredContent. This switch also decides whether a tool's `outputSchema` is
    # advertised to modern clients: declaring the schema obliges the server to answer with
    # conforming `structuredContent`, which the default `text` mode does not produce.
    answerAs: text
    hideAnnotations: false  # true — strip `annotations` from tool listings
    # Standard §8.3/§9.3 — validate tools/call arguments against each tool's inputSchema before
    # dispatch. Default true. In the modern era a violation comes back as a tool result with
    # `isError: true` and per-field diagnostics; toward legacy clients it is JSON-RPC -32602 with the
    # same diagnostics in error.data. Set false to skip input validation (tools self-validate, or
    # trusted internal deployment); does not affect outputSchema checks. ENV: MCP_TOOLS_VALIDATE_INPUT.
    validateInput: true
  # Standard §8.4 — server-side pagination for tools/list, prompts/list, resources/list.
  pagination:
    pageSize: 100                # items per page (cursor is opaque base64(offset))
  # Standard v2.0 §12.3 — freshness hints (`ttlMs` / `cacheScope`) stamped on the cacheable
  # 2026-07-28 results: server/discover, tools/list, prompts/list, resources/list,
  # resources/templates/list (listTtlMs) and resources/read (readTtlMs). Legacy responses carry none.
  cacheHints:
    listTtlMs: 60000             # catalog freshness hint, ms
    readTtlMs: 0                 # resources/read freshness hint, ms (0 = immediately stale)
    cacheScope: private          # public | private — `private` is the safe default (results vary per token)
  # Multi Round-Trip Requests (MRTR, 2026-07-28) — a tool pauses mid-call to ask the user for
  # confirmation or missing data, and the client retries with the answers plus the opaque
  # `requestState` blob the server minted.
  mrtr:
    stateSecret: ''              # HMAC secret guarding requestState integrity, min 32 chars
    stateTtlSeconds: 600         # lifetime of a minted requestState, seconds
  # Standard §11.5 — optional MAY resource capabilities. Off by default.
  resources:
    subscribeEnabled: false      # legacy `resources/subscribe` + notifications/resources/updated
    templatesEnabled: false      # advertise + serve resources/templates/list
  # Standard §15.2 — `notifications/message` emission. In the modern era the severity threshold is
  # per request (`_meta.io.modelcontextprotocol/logLevel`); legacy sessions set it via logging/setLevel.
  logging:
    enabled: true                # advertise the `logging` capability and emit notifications/message
    defaultLevel: info           # legacy-session starting threshold on the Syslog ladder
    maxBodyBytes: 4096           # serialized `data` payload ceiling; longer payloads are truncated
  # Standard §8.7 (MAY) — task-augmented execution (long-running / pollable tool calls). Off by
  # default. Modern era: the official `io.modelcontextprotocol/tasks` extension (tasks/get|update|cancel);
  # legacy era: the `tasks` capability with tasks/list|get|result|cancel. Long-running tools opt in
  # per-tool via `execution.taskSupport`. The default store is in-memory only.
  tasks:
    enabled: false               # advertise the extension / capability and accept the lifecycle methods
    defaultTtlMs: 3600000        # finished-task retention from creation (clamped to [minTtlMs, maxTtlMs])
    minTtlMs: 0                  # lower bound a client-requested ttl is clamped to
    maxTtlMs: 86400000           # hard retention ceiling (24 h)
    pollIntervalMs: 1000         # suggested client poll interval, surfaced in every task object
    maxTasks: 1000               # retained tasks cap; oldest finished evicted first
  # Standard §6 (MAY) — Streamable HTTP SSE resumability via Last-Event-ID. Legacy era only, off by default.
  sse:
    resumability: false          # wire in-memory EventStore into the transport for replay on reconnect
    maxStoredEvents: 1000        # ring-buffer size: recent events retained per process for replay

swagger:
  servers:
    - url: https://{{mcp.domain}}
      description: "PROD server"

homePage:
  helpLink:
    href: ''        # If empty — help link is not shown in footer
    text: 'Help'    # Link text (default: "Help")
  maintainer:
    href: ''        # If empty — Support link is not shown in footer
    text: 'Support' # Link text (default: "Help")

uiColor:
  # Font color of the header and a number of interface elements on the HOME page
  primary: '#0f65dc'

webServer:
  # Bind address. Default: '127.0.0.1' — loopback only (safer default, standard §6).
  # Set to '0.0.0.0' explicitly when running inside a container / behind a reverse proxy.
  host: '127.0.0.1'
  port: {{port}}
  # Array of hosts whose `Origin` header bypasses the CORS guard.
  # CORS now actively rejects unlisted origins with HTTP 403 + JSON-RPC error.
  # In production an empty list aborts startup (only while the guard is enabled).
  originHosts: ['localhost']
  # CORS origin guard. Default: enabled (true) — the `originHosts` allow-list is enforced.
  # Set `cors.enabled: false` to turn the guard OFF: the server then adds
  # `Access-Control-Allow-Origin: *` to every response and answers preflight requests,
  # so public endpoints work when fetched cross-origin from sandboxed iframes (MCP Apps
  # widgets) whose `Origin` is `null` or a dynamic host subdomain that can never match
  # `originHosts`. This opens the server to every origin — protect it by network policy /
  # a reverse proxy. When disabled, the empty-`originHosts` production check is skipped.
  cors:
    enabled: true
  # Express `trust proxy`. Set true | 'loopback' | <number> when behind an HTTPS reverse
  # proxy so /.well-known/openid-configuration derives `issuer` from X-Forwarded-* headers.
  trustProxy: false
  # Standard §7.1 — secrets in URL forbidden. POST /ct with JSON body is the only safe form;
  # GET /ct?t=<token> is disabled by default. Opt-in via allowQueryToken=true (non-prod only).
  tokenCheck:
    allowQueryToken: false
  # Authentication is configured here only when accessing the MCP server
  # Authentication in services that enable tools, resources, and prompts
  # is implemented more deeply. To do this, you need to use the information passed in HTTP headers
  # You can also use a custom authorization function
  auth:
    enabled: false # Enables/disables authorization
    # ========================================================================
    # PERMANENT SERVER TOKENS
    # Static tokens for server-to-server communication
    # CPU cost: O(1) - fastest authentication method
    #
    # To enable this authentication, you need to set auth.enabled = true
    # and set one token of at least 20 characters in length
    # ========================================================================
    permanentServerTokens: [ ] # Add your server tokens here: ['token1', 'token2']

    # ========================================================================
    # JWT TOKEN — four operating modes (since SDK 0.7.0)
    # - legacyAesCtr (default) — HS256 + AES-CTR fallback. 0.6.x parity.
    # - embedded               — ES256/RS256 with built-in IdP. Dev / demo.
    # - localKey               — ES256/RS256 verify with public key on disk.
    # - remoteJwks             — verify against external IdP's JWKS endpoint.
    # ========================================================================
    jwtToken:
      mode: legacyAesCtr   # see above
      # HS256 signing secret used ONLY by legacyAesCtr mode (minimum 8 chars)
      encryptKey: '***'
      # If webServer.auth.enabled and the parameter true, the service name and the service specified in the token will be checked
      checkMCPName: true
      # If true and JWT token contains non-empty 'ip' field,
      # the client IP will be checked against the allowed list in the token
      isCheckIP: false
      # Optional JWT `iss` claim. When non-empty, the generator stamps it and the verifier requires it.
      # legacyAesCtr only — in non-legacy modes use expectedIssuer below.
      issuer: ''

      # -------- Modes embedded / localKey / remoteJwks --------
      algorithm: ES256             # ES256 | RS256
      keyStoragePath: './keys'     # embedded: autogenerated keypair (private.pem + public.pem)
      publicKeyPath: ''            # localKey: PEM public key path
      privateKeyPath: ''           # localKey: optional — enables local issuance
      jwksUri: ''                  # remoteJwks: external JWKS endpoint
      expectedIssuer: ''           # required for embedded/localKey/remoteJwks (standard §7.2)
      expectedAudience: ''         # defaults to appConfig.name
      jwksCacheTtl: 600            # JWKS cache, seconds
      jwksCooldown: 30             # min interval between repeat fetches when kid missing
      clockSkew: 30                # allowed exp/nbf drift, seconds (max enforced: 60)
      defaultTtl: 1800             # default TTL for /oauth/token-issued tokens

    # ========================================================================
    # Basic Authentication - Base64 encoded username:password
    # CPU cost: Medium - Base64 decoding + string comparison
    # To enable this authentication, you need to set auth.enabled = true
    # and set username and password to valid values
    # ========================================================================
    basic:
      username: ''
      password: '***'

```

## Access Points

If your MCP server talks to third-party / external services (REST APIs, legacy systems, partner endpoints, etc.),
declare their connection attributes (`host`, `port`, `protocol`, `token`, credentials, custom fields) under the
top-level `accessPoints` block in the config — **not** scattered through code or ad-hoc config sections. Benefits:

- Single registry of outbound dependencies visible in diagnostics and admin pages.
- Automatic `host`/`port` resolution via Consul for services registered there.
- Uniform access pattern (`appConfig.accessPoints.<alias>`) across all tools and modules.
- Runtime updates — the SDK periodically refreshes dynamic access points from Consul without restarting the server.

The SDK automatically wraps `appConfig.accessPoints` in an `AccessPoints` instance on startup and starts the Consul
updater — **do not call `new AccessPoints(...)` or `accessPointUpdater.start()` manually**.

### Declaring Access Points

```yaml
accessPoints:
  # Dynamic AP — host/port resolved from Consul
  wso2siAPI:
    title: 'WSO2 SI API'
    consulServiceName: 'dev01-wso2si-d2'
    host: null               # filled in from Consul
    port: 9443               # fallback; also used when Consul meta specifies a different port
    protocol: 'https'
    user: 'admin'
    pass: '***'
    myProp: 'anyValue'       # any custom field is preserved and available at runtime

  # Static AP — Consul is NOT used
  externalAPI:
    noConsul: true
    host: 'api.partner.com'
    port: 443
    protocol: 'https'
    token: '***'
    timeoutMs: 5000
```

### Using Access Points in Code

```typescript
import { appConfig } from 'fa-mcp-sdk';

// Direct access — always works, for dynamic and static APs alike
const ap = appConfig.accessPoints.wso2siAPI;
const url = `${ap.protocol}://${ap.host}:${ap.port}`;
const token = ap.token;              // custom fields available
const custom = ap.myProp;

// "Clean" copy without service fields
const ap2 = appConfig.accessPoints.getAP('wso2siAPI');

// All access points at once
const all = appConfig.accessPoints.get();

// For dynamic APs — wait until host/port are resolved from Consul (first run)
await ap.waitForHostPortUpdated(5000);
```

**Strict typing for custom fields:**

```typescript
import type { IAccessPoint } from 'fa-consul';

interface IWso2AP extends IAccessPoint {
  user: string;
  pass: string;
  myProp: string;
}

const ap = appConfig.accessPoints.wso2siAPI as IWso2AP;
```

### Access Point Properties

**User-defined (configured in YAML):**

| Property                         | Required        | Purpose                                                                               |
|----------------------------------|-----------------|---------------------------------------------------------------------------------------|
| `consulServiceName`              | yes for dynamic | Consul service name used to resolve `host`/`port`                                     |
| `host`                           | —               | IP/hostname. Dynamic: usually `null`, filled from Consul. Static (`noConsul`): manual |
| `port`                           | —               | TCP port. Coerced to `Number` or `null`. Dynamic: from Consul (or `meta.port`)        |
| `protocol`                       | —               | `http` or `https`. Anything other than `https?` is coerced to `http`, lowercased      |
| `title`                          | —               | Human-readable name (defaults to the AP key)                                          |
| `noConsul`                       | —               | `true` → static AP: Consul is not polled, `consulServiceName` is not required         |
| `retrieveProps`                  | —               | `(host, meta) => ({host, port})`. Custom extractor for Consul response                |
| `updateIntervalIfSuccessMillis`  | —               | Interval between successful Consul polls for this AP (default 2 min)                  |
| `user`, `pass`, `token`, any key | —               | Application fields — stored as-is and available at runtime                            |

**Service fields (added automatically by the SDK for dynamic APs):**

| Property                     | Purpose                                                                 |
|------------------------------|-------------------------------------------------------------------------|
| `id`                         | The AP key from the config                                              |
| `isAP`                       | Marker for a dynamic AP; absent on `noConsul` APs                       |
| `meta`                       | Filled from `Service.Meta` of the Consul service on successful poll     |
| `isReachable`                | `true` if the last Consul poll returned data                            |
| `lastSuccessUpdate`          | Timestamp of the last successful update                                 |
| `idHostPortUpdated`          | `true` once `host` + `port` have been populated at least once           |
| `setProps(data)`             | Method for externally updating AP fields                                |
| `waitForHostPortUpdated(ms)` | Promise that resolves when `host`/`port` have been populated            |
| `getChanges()`               | Returns `[propName, oldValue, newValue][]` for the last `setProps` call |

### `noConsul` Access Points

Setting `noConsul: true` makes the access point **static** — its address is not resolved through Consul. Typical use
cases: partner APIs, legacy systems, or services with fixed addresses that cannot (or should not) be registered in
Consul.

Differences from a dynamic AP:

- `consulServiceName` is not required.
- The AP object is stored **as-is** — no normalization of `port`/`protocol`, no service fields (`isAP`, `setProps`,
  `waitForHostPortUpdated`, etc.) are added.
- The AP is excluded from Consul polling; `host`/`port` are never overwritten.
- `getAP('key')` and `get()` do **not** return static APs by default (they filter on `isAP`). Pass `andNotIsAP = true`
  to include them, or use direct access — `appConfig.accessPoints.externalAPI` — which always works.

```typescript
appConfig.accessPoints.getAP('externalAPI', true);  // include static AP in lookup
appConfig.accessPoints.externalAPI;                 // direct access always works
```

### Custom Fields

Any additional property on an AP (`apiKey`, `timeoutMs`, `headers: {...}`, etc.) is preserved verbatim and accessible at
runtime:

- On creation, all fields from the config are copied onto the AP object.
- Periodic Consul updates only refresh `host`/`port` (and optionally `meta`) — other properties are **never
  overwritten**.
- `get()` / `getAP()` copy all enumerable properties except `undefined` and functions.
- Nested objects are copied shallowly — if a custom field is an object, its inner references are shared with the
  original config.
- Only `port` (coerced to `Number`) and `protocol` (coerced to `http`/`https`) are normalized; all other fields are
  left untouched.

### Subscribing to Updates

When a dynamic AP is refreshed from Consul, events are emitted on the SDK's `eventEmitter`
(see "Event System" in `06-utilities.md`):

```typescript
import { eventEmitter } from 'fa-mcp-sdk';

eventEmitter.on('access-point-updated', ({ accessPoint, changes }) => {
  // changes: [propName, oldValue, newValue][]
});
eventEmitter.on('access-points-updated', () => { /* any AP was updated this cycle */ });
```

## Cache

```typescript
import { getCache } from 'fa-mcp-sdk';

const cache = getCache();  // Default options
const cache = getCache({ ttlSeconds: 600, maxItems: 5000 });

// Methods
cache.set('key', value, ttlSeconds?);
cache.get<T>('key');
cache.has('key');
cache.del('key');
cache.take<T>('key');              // Get and delete
cache.mget<T>(['k1', 'k2']);
cache.mset([{ key: 'a', val: 1 }, { key: 'b', val: 2, ttl: 600 }]);
cache.keys();
cache.flush();
cache.ttl('key', seconds);         // Update TTL
cache.getTtl('key');
cache.getStats();                  // { hitRate, keys, vsize }
cache.close();

// Get-or-set pattern
const data = await cache.getOrSet('key', async () => await fetchData(), 3600);
```

## Database

PostgreSQL integration (including the `MAIN` sugar layer — `queryMAIN`, `execMAIN`, `getMergeSqlMAIN`,
`mergeByBatch`, `pgvector` support, etc.) is documented in [09-database.md](09-database.md).

Minimal config snippet (see [09-database.md](09-database.md) for the full reference):

```yaml
db:
  postgres:
    dbs:
      main:
        label: 'My Database'
        host: ''                    # empty string disables DB (isMainDBUsed = false)
        port: 5432
        database: <database>
        user: <user>
        password: <password>
        usedExtensions: []          # e.g. [pgvector]
```


## Protocol Eras and What They Change in the Config

The server is dual-era: one `/mcp` endpoint serves both protocol generations, and no configuration key selects
between them — the era is derived from the traffic itself.

| Era | Revision | How it is recognised | Shape |
|-----|----------|----------------------|-------|
| Modern | `2026-07-28` | Per-request `_meta` envelope (or a `server/discover` probe) | Stateless: no `initialize`, no sessions, client capabilities and log level travel in every request |
| Legacy | `2025-11-25` and earlier | An `initialize` request, or an `Mcp-Session-Id` header | Sessionful: handshake first, session-scoped capabilities, log level and subscriptions |

Modern traffic is served by the official `@modelcontextprotocol/server@2` package; legacy traffic keeps the
`@modelcontextprotocol/sdk@1.29` session path. On the STDIO transport the era is decided from the connection's
opening message and pinned for the lifetime of the process. Several `mcp.*` keys therefore behave differently
depending on which client is talking — each section below states the era it applies to.

## Pagination (`mcp.pagination`)

Standard §8.4 — server-side pagination for `tools/list`, `prompts/list`, and
`resources/list`. The SDK sorts items stably by `name` / `uri`, slices the list, and
returns `nextCursor` (opaque base64 of the next offset) when more entries follow.

| Key | Default | Notes |
|-----|---------|-------|
| `mcp.pagination.pageSize` | `100` | Items per page; lower this for low-context clients (e.g. terminal MCP clients) or raise it for power users. |

Override per environment via `MCP_PAGINATION_PAGE_SIZE`. Invalid cursors return JSON-RPC
`-32602` with `error.data.field: 'cursor'`.

```bash
# clients without pagination support still see the first page — fully spec-compliant
curl -s ... -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# clients that opt in
curl -s ... -d '{"jsonrpc":"2.0","method":"tools/list","id":1,"params":{"cursor":"NTA="}}'
```

## Tool Response Shape and Input Validation (`mcp.tools`)

| Key | Default | Notes |
|-----|---------|-------|
| `mcp.tools.answerAs` | `text` | `text` puts serialized JSON in `content[0].text`; `structuredContent` returns the object in `result.structuredContent`. It also gates `outputSchema`: a tool's schema is advertised to modern clients **only** under `structuredContent`, because declaring the schema obliges the server to answer with conforming `structuredContent` — which the `text` shape never produces. Env `MCP_TOOLS_ANSWER_AS`. |
| `mcp.tools.hideAnnotations` | `false` | Strip `annotations` (`readOnlyHint`, `destructiveHint`, …) from tool listings. Env `MCP_TOOLS_HIDE_ANNOTATIONS`. |
| `mcp.tools.validateInput` | `true` | Validate `tools/call` arguments against the tool's `inputSchema` before dispatch. Env `MCP_TOOLS_VALIDATE_INPUT`. |

A schema violation is reported differently per era. Modern clients receive a normal tool result carrying
`isError: true` plus the per-field diagnostics, so the model can read the complaint and retry with corrected
arguments. Legacy clients receive the JSON-RPC protocol error `-32602` with the same diagnostics in `error.data`
(`field`, `reason`, `errors[]`). Turning the flag off skips argument validation entirely in both eras; it never
affects `outputSchema` checks, which the modern runtime always enforces once the schema is advertised.

A task-capable tool (`execution.taskSupport`, with `mcp.tasks.enabled: true`) also keeps its `outputSchema`
unadvertised, because its answer may be a task handle rather than the tool's own payload.

## Cache Hints (`mcp.cacheHints`)

MCP `2026-07-28` requires every cacheable result to state how long it stays fresh and who may keep it. The SDK
stamps `ttlMs` and `cacheScope` on `server/discover`, `tools/list`, `prompts/list`, `resources/list`,
`resources/templates/list` (all from `listTtlMs`) and on `resources/read` (from `readTtlMs`). Legacy-era responses
carry no cache hints and are unaffected by this section.

| Key | Default | Notes |
|-----|---------|-------|
| `mcp.cacheHints.listTtlMs` | `60000` | Freshness hint for catalog results, milliseconds. Raise it when the tool/prompt/resource catalog is static; lower it when tools appear and disappear per deployment. Env `MCP_CACHE_LIST_TTL_MS`. |
| `mcp.cacheHints.readTtlMs` | `0` | Freshness hint for `resources/read` results, milliseconds. `0` means "immediately stale" — every read goes to the server. Env `MCP_CACHE_READ_TTL_MS`. |
| `mcp.cacheHints.cacheScope` | `private` | `private` — only the caller that fetched the result may reuse it. `public` — any client or shared proxy may reuse it for any caller. Env `MCP_CACHE_SCOPE`. |

`private` is the safe default because listings and reads may vary per token: a server that filters tools by scope
or returns per-user resources would otherwise hand one caller's view to another through a shared cache. Set
`cacheScope: public` only when the catalog and the resource bodies are provably identical for every caller.

## Multi Round-Trip Requests (`mcp.mrtr`)

MRTR is the `2026-07-28` mechanism that lets a tool pause in the middle of a call and ask the user for
confirmation or for data the model did not supply. The server answers with `resultType: "input_required"` and an
opaque `requestState` blob; the client collects the answers and retries the same call, echoing that blob back.
Because the blob travels through the client, its integrity is protected by an HMAC signature, bound to the
originating method and the authenticated principal, and limited by a TTL. Verification happens before any tool
code runs, so a tampered, expired or foreign blob never reaches a handler.

| Key | Default | Notes |
|-----|---------|-------|
| `mcp.mrtr.stateSecret` | `''` | HMAC secret protecting `requestState` integrity. Minimum 32 characters. Env `MCP_MRTR_STATE_SECRET`. |
| `mcp.mrtr.stateTtlSeconds` | `600` | How long a minted `requestState` stays valid, seconds. A retry after this window is rejected and the client must start the call over. Env `MCP_MRTR_STATE_TTL_SECONDS`. |

**Operational note — this is the key to set before scaling out.** When `stateSecret` is empty (the default), the
server generates a random key at startup and keeps it in process memory. That is fine for a single instance, but it
has two consequences: a restart invalidates every round trip that is still in flight (clients get a rejected
`requestState` and must redo the call), and **multiple instances behind a load balancer MUST share one secret** —
otherwise the instance that receives the retry cannot verify a blob minted by a sibling. Set the same value in
`config/production.yaml` (or via `MCP_MRTR_STATE_SECRET`) on every replica. A secret shorter than 32 characters is
refused: the server logs a warning and falls back to the random per-process key, so a too-short value behaves
exactly like no value at all.

The tool-side helpers (`formatInputRequired`, `isInputRequiredResponse`) and the handler fields that carry the
answers back (`inputResponses`, `requestStatePayload`) are described in
[06-utilities → "Multi Round-Trip Requests"](./06-utilities.md).

## Resource MAY capabilities (`mcp.resources`)

Standard §11.5 — opt-in templates and subscriptions. Defaults keep the server in the
"static resources only" mode that low-context clients expect.

| Key | Default | Notes |
|-----|---------|-------|
| `mcp.resources.subscribeEnabled` | `false` | Legacy era: advertise `subscribe` + `listChanged` and register `resources/subscribe`. Project code emits change events via `notifyResourceUpdated(server, uri)`. |
| `mcp.resources.templatesEnabled` | `false` | Advertise + serve `resources/templates/list`. Templates come from `McpServerData.customResourceTemplates`. |

Modern clients do not use `resources/subscribe` at all — they open a `subscriptions/listen` stream and receive
the same change notifications through it, independently of this flag. Publish those events with the `mcpNotify`
helper (`resourceUpdated(uri)`, `toolsChanged()`, …); `notifyResourceUpdated(server, uri)` also routes into it, so
project code written against the legacy API reaches modern subscribers too. See
[02-2-prompts-and-resources → "Optional MAY capabilities"](./02-2-prompts-and-resources.md#optional-may-capabilities-templates--subscribe-standard-115)
for end-to-end examples.

## Log Notification Threshold (`mcp.logging`)

Standard §15.2 — the `notifications/message` channel a tool writes to through the `log()` emitter on
`IToolHandlerParams`.

| Key | Default | Notes |
|-----|---------|-------|
| `mcp.logging.enabled` | `true` | Advertise the `logging` capability and emit `notifications/message`. Env `MCP_LOGGING_ENABLED`. |
| `mcp.logging.defaultLevel` | `info` | Starting severity threshold of a legacy session on the Syslog ladder (`debug` … `emergency`). Env `MCP_LOGGING_DEFAULT_LEVEL`. |
| `mcp.logging.maxBodyBytes` | `4096` | Serialized `data` payload ceiling; longer payloads are truncated. Env `MCP_LOGGING_MAX_BODY_BYTES`. |

The threshold is era-specific. A modern request carries its own level in `_meta.io.modelcontextprotocol/logLevel`
and is filtered against that value alone — a request that omits the field receives no log notifications at all,
which is what the specification prescribes, so `defaultLevel` has no effect on modern traffic. A legacy session is
filtered by the level its client set with `logging/setLevel`, starting from `defaultLevel`.

## Task-Augmented Execution (`mcp.tasks`)

Standard §8.7 (MAY) — long-running tool calls the client polls instead of waiting on. Off by default; a tool opts in
per-tool with `execution.taskSupport`. The default store keeps tasks in process memory only and does not survive a
restart.

| Key | Default | Notes |
|-----|---------|-------|
| `mcp.tasks.enabled` | `false` | Advertise task support and accept the lifecycle methods. Env `MCP_TASKS_ENABLED`. |
| `mcp.tasks.defaultTtlMs` | `3600000` | Retention of a finished task from creation; a client-requested ttl is clamped to `[minTtlMs, maxTtlMs]`. |
| `mcp.tasks.minTtlMs` / `maxTtlMs` | `0` / `86400000` | Clamp bounds for a client-requested ttl. |
| `mcp.tasks.pollIntervalMs` | `1000` | Poll interval suggested to the client in every task object. |
| `mcp.tasks.maxTasks` | `1000` | Cap on simultaneously retained tasks; the oldest finished tasks are evicted first. |

In the modern era Tasks are the official extension `io.modelcontextprotocol/tasks`, advertised in
`server/discover` under `capabilities.extensions` and returned only to clients that declare the same extension in
their request. The modern method set is `tasks/get`, `tasks/update` (the re-entry point that feeds MRTR answers
back into a paused tool) and `tasks/cancel` — there is no `tasks/list` and no `tasks/result` there. Legacy clients
keep the `tasks` capability with `tasks/list`, `tasks/get`, `tasks/result` and `tasks/cancel`.

## SSE stream resumability (`mcp.sse`)

Standard §6 (MAY) — opt-in replay of missed Streamable HTTP SSE events after a reconnect. Legacy era only: the
modern revision has neither sessions nor resumable streams, so this section is inert for modern clients. Off by
default, and only relevant for the HTTP transport.

| Key | Default | Notes |
|-----|---------|-------|
| `mcp.sse.resumability` | `false` | When `true`, an in-memory `InMemoryEventStore` is wired into the Streamable HTTP transport. A legacy client reconnecting to `GET /mcp` with a `Last-Event-ID` header replays the events it missed. Env `MCP_SSE_RESUMABILITY`. |
| `mcp.sse.maxStoredEvents` | `1000` | Ring-buffer size — how many recent events are retained per process for replay. Env `MCP_SSE_MAX_STORED_EVENTS`. |

The store is a per-process ring buffer: it does not survive a restart and is not shared across
instances. For multi-replica deployments either pin reconnects to the same instance (sticky sessions
by `Mcp-Session-Id`) or implement a shared `EventStore`. Events evicted past `maxStoredEvents` are not
replayed — the client simply resumes from the current moment, without error.

## HTTP Transport Hardening (`mcp.limits`)

Standard §14 mandates explicit ceilings on request body, tool result and tool execution time. The
SDK enforces all three from `mcp.limits` — see the snippet under "config/default.yaml" above.

| Key | Default | What happens above the limit |
|-----|---------|------------------------------|
| `mcp.limits.maxPayloadBytes` | 1 MiB | JSON-RPC `-32005` + HTTP **413 Payload Too Large**. The Express `entity.too.large` error is translated automatically — clients never see the default HTML error page. |
| `mcp.limits.maxToolResultBytes` | 10 MiB | Response is truncated. `structuredContent.truncated: true` is set on structured payloads; `…[truncated]` marker is appended to oversized text content. Standard §12.2. |
| `mcp.limits.toolTimeoutMs` | 30 000 ms | JSON-RPC `-32004` + HTTP **504 Gateway Timeout** on `/mcp`. The pending tool promise is left running (Node can't synchronously abort user code); your tool SHOULD also self-cancel if it watches the elapsed time. |

Override per-environment in `config/{development,production,local}.yaml` or via env vars
(`MCP_LIMITS_MAX_PAYLOAD_BYTES`, `MCP_LIMITS_MAX_TOOL_RESULT_BYTES`, `MCP_LIMITS_TOOL_TIMEOUT_MS`).

## Health, Readiness, CORS

| Endpoint / Setting | Behaviour | Standard |
|--------------------|-----------|----------|
| `GET /health` | Returns `{ status, version, uptime, details }`. HTTP **503** when `status === 'unhealthy'`, **200** otherwise. | §16.1 |
| `GET /ready` | No auth. Returns `{ status, checks: { db, cache, jwks } }`. Each check is `'ok' \| 'error' \| 'skipped'` — never leaks credentials or connection strings. HTTP **503** when any check fails, **200** when all green. | §16.2 / §16.3 |
| `webServer.host` | Default `'127.0.0.1'` (loopback). Containers / k8s pods / public-facing deployments MUST set `'0.0.0.0'` explicitly. | §6 |
| `webServer.originHosts` | Empty list in production aborts `initMcpServer()` (while the guard is on). Unlisted `Origin` headers receive HTTP **403** + JSON-RPC error (no longer silently allowed). | §6 |
| `webServer.cors.enabled` | Default `true` — origin guard on, `originHosts` allow-list enforced. Set `false` to disable the guard: every response carries `Access-Control-Allow-Origin: *` and preflight requests are answered, so cross-origin fetches from sandboxed iframes (MCP Apps widgets) with a `null`/dynamic `Origin` succeed. Disabling skips the empty-`originHosts` production check and logs a warning at startup — the server is then open to every origin and MUST be protected by network policy / a reverse proxy. | §6 |

## MCP-Specific JSON-RPC Error Codes (Appendix B)

| Code | Class | HTTP | When |
|------|-------|------|------|
| `-32002` | `ResourceNotFoundError` | 404 | Resource not found — emitted toward legacy clients only (legacy SSE `/messages`, missing JWKS key, etc.). In the modern era the same condition is reported as `-32602`. |
| `-32003` | `RateLimitedError` | 429 | Per-client rate limit exceeded. Response carries the `Retry-After` HTTP header AND `error.data.retryAfter` (seconds). |
| `-32004` | `TimeoutError` | 504 | Tool execution exceeded `mcp.limits.toolTimeoutMs`. Timeout is the only meaning of this code — an insufficient-scope rejection is `-32000` with `error.data.reason: "insufficient_scope"`. |
| `-32005` | `PayloadTooLargeError` | 413 | Request body exceeded `mcp.limits.maxPayloadBytes`. |
| `-32006` | `UpstreamUnavailableError` | 503 | A downstream dependency the tool proxies is unreachable or answered 502/503/504. |
| `-32007` | `ConflictError` | 409 | The requested change conflicts with the current state of the target entity. |

Codes reserved by the specification and produced by the modern runtime itself (they are protocol-level
rejections, so no SDK error class maps to them and project code MUST NOT allocate in `-32020…-32099`):

| Code | Name | HTTP | When |
|------|------|------|------|
| `-32020` | HeaderMismatch | 400 | A required request header is missing or does not match the body — see the header rules in [06-utilities → "Streamable HTTP Troubleshooting"](./06-utilities.md). |
| `-32021` | MissingRequiredClientCapability | 400 | The request needs a client capability the client did not declare in its `_meta` envelope. |
| `-32022` | UnsupportedProtocolVersion | 400 | The requested protocol revision is not served; `error.data` lists the supported ones. |

`-32001` is the legacy-era session error: an unknown or expired `Mcp-Session-Id` receives HTTP 404 with this code
and the instruction to re-initialize.

Import the classes (and the `MCP_ERROR_CODES` map) from the SDK root:

```typescript
import {
  PayloadTooLargeError, TimeoutError, RateLimitedError, ResourceNotFoundError,
  MCP_ERROR_CODES,
  createJsonRpcErrorResponse,    // accepts (err, requestId?, extraData?)
  IMcpErrorData,                 // { requestId?, field?, reason?, retryAfter?, [k]: unknown }
} from 'fa-mcp-sdk';
```

All four extend `BaseMcpError`. The `createJsonRpcErrorResponse` helper emits the canonical
`error.data` shape from Appendix B.3 — `{ requestId?, field?, reason?, retryAfter?, … }`.
Stack traces and internal paths are NEVER included in `error.data` (standard §13.3).

