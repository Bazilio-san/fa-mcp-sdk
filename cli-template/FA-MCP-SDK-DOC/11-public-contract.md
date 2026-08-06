# 11 — Public Contract

This document is the **formal public contract** of the `fa-mcp-sdk` package. Everything listed
here is part of the API surface that the SDK guarantees, and every change to it follows the
versioning policy at the bottom of this file (semver: MAJOR / MINOR / PATCH).

If a behaviour is **not** described here — even if it is currently observable in the source — it
is considered an implementation detail and may change in any release.

---

## 1. Transports and protocol eras

The server is **dual-era**: one and the same endpoint serves two generations of the MCP protocol at the
same time. The era of a request is derived from the request itself — there is no configuration switch, no
second port, and no separate deployment.

| Era        | Revision(s)              | Shape                                                                     |
|------------|--------------------------|---------------------------------------------------------------------------|
| **modern** | `2026-07-28`             | Stateless — no `initialize`, no sessions; every request carries a `_meta` envelope |
| **legacy** | `2025-11-25` and earlier | `initialize` handshake plus `Mcp-Session-Id` session state                 |

The modern era is served by the official `@modelcontextprotocol/server@2` package (`src/core/mcp/v2/`),
the legacy era by `@modelcontextprotocol/sdk@1.29` (`src/core/mcp/create-mcp-server.ts`).

| Transport          | Standard | Status | Eras   | Notes                                                        |
|--------------------|----------|--------|--------|---------------------------------------------------------------|
| `stdio`            | §6       | MUST   | both   | Single JSON-RPC stream over stdin/stdout; the era is pinned from the opening message |
| `streamable_http`  | §6       | MUST   | both   | `POST /mcp` serves both eras; `GET` / `DELETE /mcp` serve legacy sessions only |
| `legacy_http_sse`  | §6       | SHOULD | legacy | `GET /sse` + `POST /messages` — the Deprecated HTTP+SSE transport |

All HTTP routes hosted by the SDK are listed in §2.

### 1.1 The modern `_meta` envelope

Every modern request MUST carry a `_meta` object inside `params`. It replaces everything the `initialize`
handshake used to establish once per session:

| `_meta` key                                  | Status | Value                                                              |
|----------------------------------------------|--------|--------------------------------------------------------------------|
| `io.modelcontextprotocol/protocolVersion`     | MUST   | `2026-07-28`                                                       |
| `io.modelcontextprotocol/clientCapabilities`  | MUST   | Capability object (`elicitation`, `sampling`, `roots`, `extensions`) |
| `io.modelcontextprotocol/clientInfo`          | MAY    | `{ name, version }` — client identity for logs and diagnostics     |
| `io.modelcontextprotocol/logLevel`            | MAY    | Per-request `notifications/message` threshold (§4.2)               |

A missing or malformed envelope is answered with `-32602`. A method that needs a client capability the
envelope does not declare is answered with `-32021`. W3C trace context (`traceparent` / `tracestate`) is
accepted in `_meta` as well as in HTTP headers; the HTTP headers win when both are present (§15.1).

### 1.2 `POST /mcp` routing

A single route decides the era per request, in this order:

| Condition on the request                                      | Outcome                                                       |
|---------------------------------------------------------------|---------------------------------------------------------------|
| Carries a **known** `Mcp-Session-Id`                          | Legacy session path (v1 transport)                            |
| Carries an **unknown / expired** `Mcp-Session-Id`, not `initialize` | HTTP 404 + `-32001` `Session not found: re-initialize to obtain a new session` |
| Is an `initialize` request                                    | A legacy session is created; the server mints `Mcp-Session-Id` |
| Anything else                                                 | The v2 stateless handler — modern traffic and sessionless legacy traffic |

`GET /mcp` (server-initiated SSE stream) and `DELETE /mcp` (teardown) exist only for legacy sessions; both
answer `-32001` when the session id is unknown. Modern clients need neither: server-initiated messages
arrive on `subscriptions/listen` (§4.3) and there is no session to tear down.

### 1.3 STDIO era selection

STDIO is dual-era too. The era is a property of the connection, decided from its **opening message** and
pinned for the process lifetime: an opening message that carries the `_meta` protocol-version key, or the
`server/discover` probe, selects the modern path (`src/core/mcp/v2/stdio.ts`); anything else — `initialize`
first of all — selects the unchanged legacy path. Messages that arrive before the decision is made are
buffered and replayed into the branch that wins, so ordering is preserved.

**SSE resumability (opt-in, §6 MAY, legacy era).** With `mcp.sse.resumability: true` the legacy Streamable
HTTP transport keeps recent SSE events in a per-process in-memory ring buffer (`mcp.sse.maxStoredEvents`,
default 1000), so a client reconnecting to `GET /mcp` with a `Last-Event-ID` header replays the events it
missed. Off by default. The buffer does not survive a restart and does not span multiple server instances —
a persistent store would be required for that.

---

## 2. HTTP endpoints

| Path                                              | Method | Auth | Level  | Purpose                                                       |
|---------------------------------------------------|--------|------|--------|---------------------------------------------------------------|
| `/mcp`                                            | POST   | Yes  | MUST   | Dual-era JSON-RPC entry point — modern and legacy alike (§1.2) |
| `/mcp`                                            | GET    | Yes  | MUST   | Server-initiated SSE stream for an active **legacy** session   |
| `/mcp`                                            | DELETE | Yes  | MUST   | **Legacy** session teardown                                    |
| `/sse`                                            | GET    | Yes  | SHOULD | Deprecated HTTP+SSE transport — connect                        |
| `/sse`                                            | POST   | Yes  | SHOULD | Deprecated HTTP+SSE transport — direct JSON-RPC                |
| `/messages`                                       | POST   | Yes  | SHOULD | Deprecated HTTP+SSE transport — message channel                |
| `/health`                                         | GET    | No   | MUST   | Liveness; returns `{status, version, uptime, details}`        |
| `/ready`                                          | GET    | No   | SHOULD | Readiness; `{status, checks}`                                 |
| `/metrics`                                        | GET    | No   | SHOULD | Prometheus exposition (opt-in via `webServer.metrics.enabled`) |
| `/`                                               | GET    | No   | MAY    | Static home page                                              |
| `/ct`                                             | POST   | No   | MUST   | Token validity check via JSON body                            |
| `/ct?t=…`                                         | GET    | No   | MAY    | Disabled by default (`webServer.tokenCheck.allowQueryToken`)  |
| `/used-http-headers`                              | GET    | No   | MAY    | Returns the project's `usedHttpHeaders` declaration           |
| `/.well-known/oauth-protected-resource`           | GET    | No   | MUST*  | Active in JWT modes `embedded` / `localKey` / `remoteJwks`    |
| `/.well-known/openid-configuration`               | GET    | No   | MUST*  | OIDC discovery                                                |
| `/.well-known/jwks.json`                          | GET    | No   | MUST*  | JWK Set with the active public key                            |
| `/oauth/token`                                    | POST   | No   | MUST*  | Embedded IdP — `grant_type=password`                          |
| `/gen-jwt`                                        | POST   | Yes  | MAY    | JWT issuance API (`webServer.genJwtApiEnable`)                |
| `/admin`                                          | GET    | Yes  | MAY    | Token Generator UI                                            |
| `/agent-tester`                                   | GET    | Yes? | MAY    | Built-in chat UI (`agentTester.enabled`)                      |
| `/api/openapi.json` / `/api/openapi.yaml` / `/docs` | GET  | -    | MAY    | OpenAPI when the project supplies `httpComponents.apiRouter`  |

`MUST*` rows are mandatory only when the corresponding feature is active.

---

## 3. Authentication

The SDK accepts the following `Authorization` schemes, picked by header format (not order):

- `Bearer <token>` — JWT (any of the four modes: `legacyAesCtr` / `embedded` / `localKey` /
  `remoteJwks`) or a permanent server token.
- `Basic <base64>` — HTTP Basic auth.
- Optional `customAuthValidator` — last fallback for project-specific schemes.

JWT modes are documented in [04-authentication](04-authentication.md). Public contract:

| Claim       | Required | Notes                                                                    |
|-------------|----------|--------------------------------------------------------------------------|
| `sub`       | MUST     | Subject — drives rate-limit bucket and concurrency cap                   |
| `exp`       | MUST     | Expiration; SDK enforces with `clockSkew` (default 30 s, max 60 s)       |
| `aud`       | SHOULD   | Defaults to `appConfig.name`; configurable via `expectedAudience`        |
| `iss`       | SHOULD*  | Required in modes `embedded` / `localKey` / `remoteJwks`                 |
| `scope`     | MAY      | Space-separated scopes; matched against `requiredScopes` per §7.5        |
| `ip`        | MAY      | When set + `isCheckIP=true`, client IP must match                        |
| `service`   | MAY      | When set + `checkMCPName=true`, must contain `appConfig.name`            |
| `jti`       | MAY      | Used by the revocation list                                              |

Scopes are matched against `requiredScopes` on tools, prompts, and resources (§7.5).

`WWW-Authenticate: Bearer realm="<name>" resource_metadata="<url>"` is emitted on every 401
from MCP endpoints per §7.4. 403 responses (authenticated but forbidden) carry NO
`WWW-Authenticate` header.

A small set of discovery methods is served without authentication so that a client can learn what the
server is before it presents a credential: `server/discover`, `initialize`,
`notifications/initialized`, `ping`, `tools/list`, `prompts/list`, `resources/list`, plus
`resources/read` / `prompts/get` for entries whose `requireAuth` is not `true`. Every other method
requires a valid `Authorization` header.

---

## 4. MCP methods

The **Era** column says which protocol generation (§1) serves a method. `both` means the same handler
answers the method for modern and legacy callers alike.

| Method                                | Era     | Status | Notes                                                 |
|---------------------------------------|---------|--------|-------------------------------------------------------|
| `server/discover`                     | modern  | MUST   | Identity, capabilities and supported versions in one call (§4.1) |
| `initialize`                          | legacy  | MUST   | Opens a session; the server mints `Mcp-Session-Id`    |
| `notifications/initialized`           | legacy  | MUST   | Handshake completion                                  |
| `ping`                                | legacy  | SHOULD | Liveness probe of an established session              |
| `tools/list`                          | both    | MUST   | Deterministic order — tools sorted by `name`; pagination via `mcp.pagination.pageSize` |
| `tools/call`                          | both    | MUST   | Honours `signal`, `_meta.progressToken`, `requiredScopes`; may answer `input_required` (§4.4) or `task` (§4.5) |
| `prompts/list`                        | both    | MUST   | Capability advertised only when the server has prompts (§8.2) |
| `prompts/get`                         | both    | MUST   | Returns `-32601` when no prompts are configured       |
| `resources/list`                      | both    | MUST   | Same pagination contract                              |
| `resources/read`                      | both    | MUST   | Returns `text` or base64 `blob` per entry (§11.4)     |
| `resources/templates/list`            | both    | MAY    | `mcp.resources.templatesEnabled`                      |
| `resources/subscribe` / `unsubscribe` | legacy  | MAY    | `mcp.resources.subscribeEnabled`; replaced by `subscriptions/listen` (§4.3) |
| `subscriptions/listen`                | modern  | MUST   | Opt-in server→client notification stream (§4.3)       |
| `completion/complete`                 | both    | MAY    | `mcp.completions.enabled` + `completionProvider` (§8.2) |
| `tasks/get`                           | modern  | MAY    | Tasks extension; current task metadata and result (§4.5) |
| `tasks/update`                        | modern  | MAY    | Tasks extension; supplies mid-flight input to a paused task (§4.5) |
| `tasks/cancel`                        | modern  | MAY    | Tasks extension; aborts a running task, idempotent (§4.5) |
| `tasks/list`                          | legacy  | MAY    | `mcp.tasks.enabled`; caller's own tasks, newest first, paginated (§8.7) |
| `tasks/result`                        | legacy  | MAY    | `mcp.tasks.enabled`; the `tools/call` result once completed (§8.7) |
| `logging/setLevel`                    | legacy  | SHOULD | Session-wide threshold; the modern era sets it per request (§4.2) |
| `notifications/message`               | both    | SHOULD | Emitted by `sendLoggingMessage()` / `IToolHandlerParams.log()` |
| `notifications/progress`              | both    | SHOULD | Emitted by `IToolHandlerParams.sendProgress()` (§4.2, §8.6) |
| `notifications/cancelled`             | legacy  | SHOULD | Aborts `IToolHandlerParams.signal` (§8.5); a modern call is aborted by the client closing its own request |
| `notifications/subscriptions/acknowledged` | modern | MUST | First message on every `subscriptions/listen` stream (§4.3) |
| `notifications/tasks/status`          | legacy  | MAY    | Emitted on every task status transition (§8.7)        |

### 4.1 `server/discover` and the result envelope

`server/discover` is the modern era's replacement for the `initialize` handshake and the one method a
modern client MUST be able to call before anything else. It needs no credential (§3) and returns:

| Field                                       | Status | Value                                                        |
|---------------------------------------------|--------|--------------------------------------------------------------|
| `supportedVersions`                          | MUST   | `["2026-07-28"]`                                             |
| `capabilities`                               | MUST   | `resources`, `prompts`, `tools`, `completions`, `logging`, `extensions` — each present only when served |
| `instructions`                               | MAY    | Free-form guidance for the model                             |
| `_meta["io.modelcontextprotocol/serverInfo"]`| MUST   | `{ name, version }` from `appConfig`                         |
| `ttlMs` / `cacheScope`                       | MUST   | Cache hints, as on every cacheable result (below)            |

**`resultType`.** Every modern result carries a `resultType` discriminator:

| `resultType`     | Meaning                                                                       |
|------------------|-------------------------------------------------------------------------------|
| `complete`       | The ordinary, final result                                                     |
| `input_required` | The call is paused and needs client input — multi round-trip requests (§4.4)   |
| `task`           | The call was accepted as a background task — Tasks extension (§4.5)           |

Every modern result — of any `resultType` — also carries `_meta["io.modelcontextprotocol/serverInfo"]`.

**Cache hints.** Six results are cacheable and carry `ttlMs` (freshness in milliseconds) plus
`cacheScope` (`public` or `private`): `server/discover`, `tools/list`, `prompts/list`, `resources/list`,
`resources/templates/list` and `resources/read`. The values come from `mcp.cacheHints` — `listTtlMs`
(default 60000) for the five catalog results, `readTtlMs` (default 0, i.e. immediately stale) for
`resources/read`, and `cacheScope` (default `private`, safe when results vary per token) for all six.
Legacy results carry no cache hints.

**Deterministic `tools/list`.** In both eras the tool array is sorted by `name` before it is paginated,
so the same catalog always produces the same page boundaries and the same ordering.

### 4.2 Logging and progress in the modern era

The `logging` capability is **Deprecated** in revision 2026-07-28 but remains functional for the whole
deprecation window. What changes is where the threshold lives: instead of a session-wide
`logging/setLevel`, a modern request declares its own level in `_meta.io.modelcontextprotocol/logLevel`,
and the resulting `notifications/message` are delivered on that request's own response stream. **A
request that omits the field receives no log notifications at all.** `logging/setLevel` stays a
legacy-era method.

`notifications/progress` follows the same request-scoped rule: it is emitted only when the request
carried `_meta.progressToken`, is throttled by `mcp.progress.throttleMs`, and is delivered on the
originating request's own stream.

### 4.3 `subscriptions/listen`

In the modern era a single method replaces both `resources/subscribe` and the standalone `GET /mcp`
stream. The client opens a long-lived `subscriptions/listen` request carrying an **opt-in filter** —
`toolsListChanged`, `promptsListChanged`, `resourcesListChanged` and `resourceSubscriptions` (a list of
resource URIs). Notification types the filter did not name are never delivered on that stream.

The first message on the stream is always `notifications/subscriptions/acknowledged`, which echoes the
filter the server accepted. Every subsequent message carries
`_meta["io.modelcontextprotocol/subscriptionId"]` so a client running several streams can correlate them.
Closing the request unsubscribes.

Server-side publishing goes through the exported **`mcpNotify`** facade — `toolsChanged()`,
`promptsChanged()`, `resourcesChanged()` and `resourceUpdated(uri)` — each of which fans the notification
out to every open stream that opted in. The legacy per-session `notifyResourceUpdated(server, uri)` calls
into the same facade, so project code written against the legacy API also reaches modern subscribers.

### 4.4 Multi round-trip requests (MRTR)

A tool handler that needs confirmation or missing data mid-call returns
`formatInputRequired({ inputRequests, state })` instead of a result. The client then sees
`resultType: "input_required"` together with the server's `inputRequests` and an opaque `requestState`
blob, and retries the same `tools/call` with `inputResponses` plus the echoed `requestState`; the handler
resumes with those values in `IToolHandlerParams.inputResponses` / `requestStatePayload`.

`requestState` integrity is HMAC-protected and verified **before** any handler runs, so a tampered,
expired or foreign blob never reaches tool code. The key is `mcp.mrtr.stateSecret` (minimum 32
characters; empty means a random per-process key, which is single-instance only — several instances
behind a load balancer MUST share one secret), and the blob's lifetime is `mcp.mrtr.stateTtlSeconds`
(default 600). The server never sends an input request kind the client did not declare a capability for:
such a call degrades into an actionable `isError: true` text instead.

### 4.5 Tasks

In the modern era tasks are an **extension**, `io.modelcontextprotocol/tasks`, advertised in
`server/discover` under `capabilities.extensions` when `mcp.tasks.enabled` is `true`. Its methods are
`tasks/get`, `tasks/update` and `tasks/cancel` — there is no `tasks/list` and no `tasks/result` in the
modern era; `tasks/get` returns the result once the task completes.

A task is returned only to a client that declared the extension in its own `_meta` capabilities: such a
client calling a task-capable tool gets an immediate `resultType: "task"` answer while the tool runs in
the background. A client that did not declare the extension gets the ordinary synchronous result. A tool
opts in via `execution.taskSupport` (`optional` / `required` / `forbidden`, see §5).

In the legacy era the same store backs the `tasks` capability (`{ list, cancel, requests: { tools: { call } } }`)
and a `tools/call` carrying a `task` parameter: the server returns a `CreateTaskResult`
(`{ task: { taskId, status, … } }`) immediately and runs the tool in the background. Sending `task` to a
tool that does not support it, or omitting `task` for a `required` tool, returns `-32602`.

The default task store keeps records in process memory only; it does **not** survive a restart. When
`mcp.tasks.enabled` is `false` (the default) the extension is not advertised and every `tasks/*` method
returns `-32601`.

---

## 5. Tool / Prompt / Resource format

### Tool (`Tool` from `@modelcontextprotocol/sdk`)

- `name` — MUST be `snake_case` and unique (validated at boot via
  `validate-tool-names.ts`).
- `description` — MUST be non-empty. Deprecation prefix `[DEPRECATED until …]` is added
  automatically when `_meta.deprecated` is set.
- `inputSchema` — MUST declare `$schema: 'https://json-schema.org/draft/2020-12/schema'` and
  `additionalProperties: false`.
- `outputSchema` — MAY; when present, the SDK validates `structuredContent` against it. A tool MAY
  return `structuredContent` with an empty `content`; the SDK copies it into `content[0]` as JSON text
  only for plain clients, never for MCP Apps UI clients (`io.modelcontextprotocol/ui`).
  **Advertisement to modern clients is conditional.** Declaring `outputSchema` obliges the server to
  return conforming `structuredContent` on every call, and the modern era enforces that promise. The
  schema is therefore advertised in a modern `tools/list` only when the deployment can actually keep it:
  `mcp.tools.answerAs` is `structuredContent`, and the tool is not task-capable (a task-capable tool may
  answer with a task object instead of its own payload). Under the default `answerAs: 'text'`,
  `formatToolResult()` returns `content` only, so the schema is withheld rather than violated. Legacy
  clients always see the declared schema.
- `title` — SHOULD; user-facing label.
- `execution.taskSupport` — MAY; one of `optional` / `required` / `forbidden` (default — absence is
  treated as `forbidden`, i.e. synchronous only). Controls task-augmented execution (§8.7); passed
  through verbatim in `tools/list`. Effective only when `mcp.tasks.enabled` is `true`.
- `annotations` — MAY; may be hidden via `mcp.tools.hideAnnotations`.
- `_meta._meta.requiredScopes` (or top-level `requiredScopes`) — MAY; OAuth scopes enforced
  before dispatch.
- `_meta.deprecated` — MAY; structured `IDeprecationInfo`.
- `_meta.ui` — MAY; MCP Apps widget metadata.

### Prompt (`IPromptData`)

`name`, `description`, `arguments[]` (each `IPromptArgument`), `content` (string or function),
`requireAuth`, `requiredScopes`, `deprecated`. Optional UI metadata (§10.5, MAY): `title` (human-facing
label, falls back to `name`) and `icons` (`IIcon[]` — `{ src; mimeType?; sizes? }`). Both pass through
`prompts/list` unchanged; built-in `agent_brief` / `agent_prompt` carry a `title`. The built-in
`tool_prompt` prompt is also guaranteed: it has a required `tool` argument (the MCP tool name) and
returns the tool-specific prompt supplied by the project through `McpServerData.toolPrompt`; without
that field a stub returns an empty string.

### Resource (`IResourceData` / `IResourceInfo`)

`uri`, `name`, `description`, `mimeType`, optional `title`, `size` (bytes, §11.3 MAY),
`icons` (`IIcon[]`, §11.3 MAY), `requireAuth`, `requiredScopes`, `_meta`, `deprecated`. On
`resources/list` the SDK computes `size` from the content (UTF-8 byte length for text/objects, buffer
length for blobs) when the author did not set it; lazy (function) content omits `size`. `content` is a
string / object / function for text resources, or
`IResourceBinaryContent` (`{ blob: Buffer | base64-string, base64?: boolean }`) for binary
resources — `resources/read` then returns base64 `contents[0].blob` (no `text`) with the
resource's `mimeType` (§11.4 / §12.2). Built-in URI schemes are guaranteed by the SDK:

| URI                                        | Purpose                                        |
|--------------------------------------------|------------------------------------------------|
| `project://version`                        | Returns `appConfig.version`                    |
| `use://auth`                               | Authentication self-description                |
| `<service>://agent/brief`                  | Mirrors `agent_brief` prompt                   |
| `<service>://agent/prompt`                 | Mirrors `agent_prompt` prompt                  |
| `doc://...`                                | Application docs                               |

### Sensitive data masking (`maskSensitive`, §12.2)

Masking personal / sensitive data in tool results is the server's responsibility — the SDK never masks
automatically. The optional helper `maskSensitive(value, rules)` (exported from the barrel, with the
`IMaskRules` type) is a reusable building block: it walks an object / array / string and applies explicit
rules — `fieldNames` (case-insensitive field-name match) and `patterns` (regular expressions on string
values at any depth) — replacing matches with `replacement` (a string, default `'***'`, or a function for
partial masking like `4111********1111`). It returns a new value and never mutates the input. Call it
inside a tool handler before returning the result; choosing the rules and where to apply them stays with
the server.

---

## 6. Error format

JSON-RPC errors follow Appendix B of the standard. Mapping (JSON-RPC → HTTP):

| JSON-RPC code | HTTP | Era    | Class                | Trigger                                     |
|---------------|------|--------|----------------------|---------------------------------------------|
| `-32600`      | 400  | both   | (none)               | Invalid Request                             |
| `-32601`      | 404  | both   | `ResourceNotFoundError` (when applicable) | Method/resource not found |
| `-32602`      | 400  | both   | `ValidationError`    | Invalid params (input schema, unknown tool); also a missing or malformed `_meta` envelope, and resource-not-found in the modern era |
| `-32603`      | 500  | both   | `ServerError`        | Internal error                              |
| `-32000`      | varies | both | `BaseMcpError`       | Generic SDK error                           |
| `-32001`      | 404  | legacy | (none)               | Unknown or expired `Mcp-Session-Id` on a non-`initialize` request — re-initialize to obtain a new session |
| `-32002`      | 404  | legacy | `ResourceNotFoundError` | Resource lookup failed                   |
| `-32003`      | 429  | both   | `RateLimitedError`   | Rate limit / concurrent-call cap (+ `Retry-After`) |
| `-32004`      | 504  | both   | `TimeoutError`       | `mcp.limits.toolTimeoutMs` exceeded         |
| `-32005`      | 413  | both   | `PayloadTooLargeError` | `mcp.limits.maxPayloadBytes` exceeded     |
| `-32006`      | 503  | both   | `UpstreamUnavailableError` | Dependency (DB / downstream) unreachable |
| `-32007`      | 409  | both   | `ConflictError`      | State conflict (duplicate / optimistic lock) |
| `-32020`      | 400  | modern | (none)               | HeaderMismatch — a required request header is missing, or disagrees with the body (§7.1) |
| `-32021`      | 400  | modern | (none)               | The `_meta` envelope does not declare a client capability the method needs |
| `-32022`      | 400  | modern | (none)               | Unsupported protocol version; `error.data` carries `supported` and `requested` |

**Resource-not-found differs by era.** The modern era reports a failed resource lookup as `-32602`, per
revision 2026-07-28 — `-32002` MUST NOT appear there. `-32002` remains the legacy-era code and is
translated automatically on the way out of the shared catalog functions.

**Notifications and unknown methods.** In the modern era a request without an `id` (a notification) is
answered with HTTP 202 and an empty body, and an unknown method with HTTP 404 and `-32601`.

Unrecognized internal errors are sanitized (§13.3 / Appendix C.3): the outward `error.message`
collapses to `Internal error`, the full text is written to the internal log keyed by `requestId`,
and absolute filesystem paths are scrubbed from any outward message. Recognized domain errors (any
class above) keep their message verbatim.

`error.data` is structured per Appendix B.3:

```jsonc
{
  "requestId": "uuid…",         // §15.1, always set by the SDK if absent
  "field": "name",              // first offending field (input validation diagnostics)
  "reason": "required",         // machine-readable hint — stable ajv keyword for schema violations
  "retryAfter": 12,             // seconds, for -32003
  // input-schema violations (-32602) additionally include (implementation-specific, not contractual):
  "errorCount": 2,              // total violations before truncation
  "errors": [                   // up to 8 per-field failures: { field, reason, message }
    { "field": "name", "reason": "required", "message": "root: missing required property \"name\"" }
  ]
  // …implementation-specific keys are allowed but not part of the contract
}
```

Input-argument validation against `inputSchema` is on by default and can be disabled per deployment
via `mcp.tools.validateInput: false` (env `MCP_TOOLS_VALIDATE_INPUT`). When off, malformed arguments
reach the tool handler unchecked — only the JSON-RPC envelope shape is still enforced.

---

## 7. Limits and headers

### 7.1 Modern request headers

Every modern `POST /mcp` MUST carry three headers. They exist so a proxy, gateway or audit log can route
and classify a call without parsing the JSON-RPC body, and the server verifies that each one agrees with
the body it accompanies:

| Header                 | Status | Value                                                                    |
|------------------------|--------|--------------------------------------------------------------------------|
| `MCP-Protocol-Version` | MUST   | `2026-07-28`; an unsupported value is answered with `-32022`             |
| `Mcp-Method`           | MUST   | Exactly the body's `method`                                              |
| `Mcp-Name`             | MUST*  | `params.name` (or `params.uri`) for `tools/call`, `resources/read` and `prompts/get` |

A missing required header, or a header that disagrees with the body, is answered with HTTP 400 and
`-32020` (HeaderMismatch). A value that is not header-safe — non-ASCII, whitespace, control characters —
is carried in the Base64 sentinel form `=?base64?<base64 of the value>?=`, which the server decodes
before comparing it with the body.

`Mcp-Session-Id` belongs to the legacy era only: the server mints it on `initialize` and every subsequent
request of that session MUST echo it. Modern requests never send it (§1.2).

### 7.2 Limits and response headers

| Limit / Header               | Source / Default                                                        |
|------------------------------|-------------------------------------------------------------------------|
| `mcp.limits.maxPayloadBytes` | 1 MiB                                                                   |
| `mcp.limits.maxToolResultBytes` | 10 MiB                                                                |
| `mcp.limits.toolTimeoutMs`   | 30 000 ms                                                               |
| `mcp.rateLimit.maxRequests`  | 100 / window                                                            |
| `mcp.rateLimit.windowMs`     | 60 000 ms                                                               |
| `mcp.rateLimit.maxConcurrentPerSubject` | 16                                                            |
| `mcp.pagination.pageSize`    | 100                                                                     |
| `mcp.logging.defaultLevel`   | `info` (Syslog ladder)                                                  |
| `mcp.progress.throttleMs`    | 100 (10 events/s/token)                                                 |
| `mcp.completions.enabled`    | `false` (opt-in; needs `completionProvider`)                            |
| `mcp.tasks.enabled`          | `false` (opt-in; advertises `tasks` capability)                        |
| `mcp.tasks.defaultTtlMs`     | 3 600 000 ms (finished-task retention; clamped to `[minTtlMs, maxTtlMs]`) |
| `mcp.tasks.maxTtlMs`         | 86 400 000 ms (hard retention ceiling)                                  |
| `mcp.tasks.pollIntervalMs`   | 1000 ms (suggested to client in every task object)                     |
| `mcp.tasks.maxTasks`         | 1000 (retained tasks; oldest finished evicted first)                   |
| `mcp.cacheHints.listTtlMs`   | 60 000 ms (catalog results; modern era only)                            |
| `mcp.cacheHints.readTtlMs`   | 0 ms (`resources/read` — immediately stale)                             |
| `mcp.cacheHints.cacheScope`  | `private` (`public` only when the catalog is identical for all callers) |
| `mcp.mrtr.stateSecret`       | empty (a random per-process key — single-instance deployments only)     |
| `mcp.mrtr.stateTtlSeconds`   | 600 s (lifetime of a minted `requestState`)                             |
| `webServer.metrics.enabled`  | `false` (opt-in)                                                        |
| `X-Request-Id` (response)    | Always present — generated when client did not supply one (§15.1)       |
| `tracestate` (response)      | Echoed back unchanged when client supplied a valid value                |
| `WWW-Authenticate`           | On every 401 from MCP endpoints (§7.4)                                  |
| `Retry-After`                | On every 429 (§14)                                                      |
| `MCP-Session-Id`             | Legacy era — set on `initialize`, echoed by every later request (§7.1)  |
| `MCP-Protocol-Version`       | Required on every modern request; negotiated by the transport in the legacy era |
| `Mcp-Method` / `Mcp-Name`    | Required on every modern request, must agree with the body (§7.1)       |

The per-subject concurrent-call cap (`mcp.rateLimit.maxConcurrentPerSubject`) is enforced at the HTTP
layer, in front of the modern handler, so that exhausting it stays a genuine protocol error — HTTP 429
with `-32003` and a `Retry-After` header — rather than being flattened into an `isError: true` tool
result.

---

## 8. Versioning policy (§17.1)

**Base protocol revision: MCP `2026-07-28`.** The SDK targets that revision and, for the duration of the
compatibility window, serves revisions `2025-11-25` and earlier on the same endpoints at the same time
(§1). Both eras are part of this contract: a change that breaks either one is a MAJOR change. The legacy
era is a compatibility surface, not a growth area — new protocol features land in the modern era only,
and the window closes in a future MAJOR release announced through the deprecation process of §9.

| Change                                                          | Bump  |
|-----------------------------------------------------------------|-------|
| Removing a tool / prompt / resource                             | MAJOR |
| Adding a `required` field to an `inputSchema`                   | MAJOR |
| Removing a field from an `outputSchema`                         | MAJOR |
| Changing the default JWT algorithm / mode                       | MAJOR |
| Renaming or removing an HTTP endpoint                           | MAJOR |
| Removing a configuration key (`mcp.*`, `webServer.*`, …)        | MAJOR |
| Backwards-incompatible change to `error.data` shape             | MAJOR |
| Adding a new tool / prompt / resource                           | MINOR |
| Adding an optional field to any schema                          | MINOR |
| Adding a new capability or behaviour gated by an opt-in flag    | MINOR |
| Adding a new optional configuration key (with safe default)     | MINOR |
| Extending `description` or `title`                              | PATCH |
| Bug-fix without changing the contract                           | PATCH |
| Documentation-only change                                       | PATCH |

`[BREAKING]` is the required marker in `CHANGELOG.md` for any MAJOR entry.

### Historical examples

| Release | Bump  | Driver                                                                 |
|---------|-------|------------------------------------------------------------------------|
| 0.4.145 | MINOR | MCP 2025-11-25 via SDK Streamable HTTP                                 |
| 0.5.0   | MAJOR | HTTP hardening (default bind `127.0.0.1`, error codes, rate-limit)     |
| 0.6.0   | MAJOR | Tools/Prompts/Resources contract (`additionalProperties:false`, mirror)|
| 0.7.0   | MAJOR | RS256/ES256 JWT runtime, OAuth/OIDC discovery, scope enforcement       |
| 0.8.x   | MINOR | Observability (X-Request-Id, traceparent, logging, metrics, progress)  |
| 0.9.1   | MINOR | Conditional capabilities, `-32006`/`-32007`, binary `blob`, error sanitization, opt-in completions |
| 0.10.0  | MINOR | Opt-in `tasks` capability (task-augmented execution), `execution.taskSupport`, in-memory task store |
| 0.12.x  | MINOR | MCP 2026-07-28 served alongside the legacy era on one endpoint: `server/discover`, per-request `_meta`, `subscriptions/listen`, MRTR, the Tasks extension, cache hints |

---

## 9. Deprecation process (§17.2)

Authors declare deprecation in a structured shape (no free-form `[DEPRECATED]` in descriptions):

```typescript
// tools.ts
const myTool: Tool = {
  name: 'old_tool',
  description: 'Returns the rate.',
  _meta: {
    deprecated: { until: '2026-08-28', replacedBy: 'new_tool', note: 'See migration guide' },
  },
  // …
};

// prompts / resources
const myPrompt: IPromptData = {
  name: 'old_prompt',
  description: '…',
  deprecated: { until: '2026-08-28', replacedBy: 'new_prompt' },
  // …
};
```

The SDK then:

1. mutates `description` on list responses to include
   `[DEPRECATED until YYYY-MM-DD, use <replacedBy>]`;
2. logs a `logger.warn` the first time per hour each `(kind, name)` is invoked;
3. logs a `logger.error` at registration time if `until` is already in the past — the entry
   should be removed instead of shipped.

**Window**: minimum `2 MINOR releases OR 3 months` from announcement to removal (per §17.2),
whichever is longer.

---

## 10. Public contract source list

The runtime sources of the contract above are:

- `src/core/_types_/types.ts` — `IToolHandlerParams`, `IPromptData`, `IResourceInfo`,
  `IDeprecationInfo`, `McpServerData`.
- `src/core/_types_/config.ts` — `AppConfig` (every documented configuration key).
- `src/core/errors/BaseMcpError.ts` + `src/core/errors/specific-errors.ts` — error codes.
- `src/core/mcp/create-mcp-server.ts` — legacy-era handler contract.
- `src/core/mcp/v2/factory.ts` — modern-era server surface: capabilities, cache hints, tool registration.
- `src/core/mcp/v2/handler.ts` — modern HTTP handler and the `mcpNotify` publisher (§4.3).
- `src/core/mcp/v2/mrtr.ts` — `formatInputRequired`, `requestState` codec (§4.4).
- `src/core/mcp/v2/tasks-methods.ts` — the `io.modelcontextprotocol/tasks` extension (§4.5).
- `src/core/mcp/v2/stdio.ts` — dual-era STDIO era selection (§1.3).
- `src/core/mcp/task-store.ts` — `ITaskStore` / `InMemoryTaskStore`, task lifecycle (§8.7).
- `src/core/web/server-http.ts` — HTTP endpoints, era routing, headers, response shape.
- `src/core/web/request-id.ts` — `X-Request-Id` + W3C trace context middleware.
- `src/core/mcp/mcp-logging.ts` — `logging` capability.
- `src/core/metrics/metrics.ts` — Prometheus series.
- `src/core/mcp/deprecation.ts` — deprecation lifecycle.

Anything that lives outside this list (file names, internal helpers, log line formats, etc.) is
**not** part of the contract and may change without notice.
