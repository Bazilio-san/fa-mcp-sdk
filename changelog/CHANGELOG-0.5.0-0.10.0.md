# Changelog archive — versions 0.5.0 through 0.10.0

Archived entries split out of the main [CHANGELOG.md](../CHANGELOG.md) for progressive disclosure.
Covers releases from 0.10.0 (2026-05-29) down to 0.5.0 (2026-05-28). Newest first.

## [0.10.0] - 2026-05-29

Phase 6 — Task-augmented execution (`tasks` capability + `execution.taskSupport`). Closes the last
open item of the MCP server implementation standard (§8.7 / §9.1, both MAY)
(WI-1 … WI-6). The release is fully additive
and the feature is **off by default** — with `mcp.tasks.enabled: false` server behaviour is
unchanged, so there are no `[BREAKING]` or `[BEHAVIOUR]` entries.

### Added

- **`tasks` capability (opt-in)** (WI-1, §8.7 MAY). New `mcp.tasks` config block (default
  `enabled: false`, env `MCP_TASKS_ENABLED`) with `defaultTtlMs`, `minTtlMs`, `maxTtlMs`,
  `pollIntervalMs` and `maxTasks`. When enabled, the server advertises
  `tasks: { list, cancel, requests: { tools: { call } } }` on `initialize` and registers the
  lifecycle methods. When disabled, the capability is not advertised and the `tasks/*` methods
  return `-32601`.
- **Task store** (WI-2). New `ITaskStore` abstraction with a process-memory default
  `InMemoryTaskStore`: task creation, status polling, result retrieval, cancellation, TTL expiry
  and oldest-finished eviction at the `maxTasks` cap. Exposed via `getTaskStore()` (plus
  `resetTaskStore`, `toTaskDto`, `isTerminalTaskStatus` and the `ITaskStore` / `ITaskRecord` /
  `TTaskStatus` types) from the package barrel. The default store is in-memory only and does not
  survive a process restart — documented as a limitation; a consumer may implement `ITaskStore` over
  an external store.
- **`execution.taskSupport` on tools** (WI-3, §9.1). A tool declares `execution: { taskSupport:
  'optional' | 'required' | 'forbidden' }` to control task-augmented dispatch. The field passes
  through `tools/list` unchanged. Sending a `task` parameter to a tool that does not support tasks,
  or omitting it for a `required` tool, returns `-32602`.
- **Task lifecycle methods + status notification** (WI-4, §8.7). `tasks/list` (caller's own tasks,
  newest first, paginated), `tasks/get`, `tasks/result` and `tasks/cancel` are served when the
  capability is enabled; the server emits `notifications/tasks/status` on every transition. A
  task-augmented `tools/call` returns a `CreateTaskResult` immediately and runs the tool in the
  background. Unknown / non-owned task ids return `-32002` without leaking existence.
- **Cancellation / progress / correlation / concurrency for tasks** (WI-5, §8.5/§8.6/§14/§15.1).
  `tasks/cancel` aborts the handler's `AbortSignal`; long-running tasks deliver progress via
  `notifications/progress`; the originating `requestId` is restored for background logging; an active
  task occupies a per-subject in-flight slot and creation past `maxConcurrentPerSubject` is rejected
  with `-32003`. New `mcp_tasks_total{status}` Prometheus counter.
- **Template example** (WI-6). The CLI template ships an `example_long_task` tool
  (`taskSupport: 'optional'`) that emits progress and honours cancellation.

## [0.9.1] - 2026-05-29

Phase 5 — Capabilities precision, error-code completeness, binary resources and message
sanitization. Closes the remaining §8.2 / §11.4 / §12.2 / §13.3 / Appendix B.2 / Appendix C.3
gaps in the MCP server implementation standard (WI-1 … WI-5). The release is
additive; two `[BEHAVIOUR]` changes are called out below.

### Added

- **Error codes `-32006` / `-32007`** (WI-4, Appendix B.2). New `UpstreamUnavailableError`
  (`-32006` / HTTP 503, for an unreachable database or downstream service) and `ConflictError`
  (`-32007` / HTTP 409, for state conflicts). Both carry `error.data.reason` and are exported
  from the package barrel. The PostgreSQL helpers (`queryMAIN`, `execMAIN`) now translate
  connection-class failures (network errno, SQLSTATE class 08, server-shutdown codes) into
  `UpstreamUnavailableError` via the new exported `mapDbError`, so a downed database surfaces as
  `-32006` / 503 instead of a generic `-32603` / 500.
- **Binary resources — `blob`** (WI-3, §11.4 / §12.2). `IResourceContent` accepts
  `IResourceBinaryContent` (`{ blob: Buffer | base64-string, base64?: boolean }`); `resources/read`
  returns base64 `contents[0].blob` with the resource's `mimeType` (no `text`). Buffers are
  base64-encoded by the SDK; an already-base64 string is passed through. The CLI template ships a
  sample PNG binary resource. New types `IResourceBinaryContent` / `TResourceBinaryContentFunction`
  are exported.
- **`completions` capability (opt-in)** (WI-5, §8.2 MAY). New `mcp.completions.enabled` config
  (default `false`, env `MCP_COMPLETIONS_ENABLED`) plus `McpServerData.completionProvider`. When
  both are present the server advertises `completions: {}` and serves `completion/complete`,
  returning the provider's candidate values capped at 100 with a correct `hasMore`. Without a
  provider the capability is not advertised.
- **`toMcpError` / `sanitizeOutwardMessage`** (WI-2) exported from the barrel for downstream reuse.

### Changed

- **Outward error sanitization** (WI-2, §13.3 / Appendix C.3). Every MCP request-handler error is
  now mapped through `toMcpError`, and `createJsonRpcErrorResponse` runs `sanitizeOutwardMessage`:
  recognized domain errors (those with an explicit `jsonRpcCode`) keep their message; unrecognized
  internal errors collapse to `Internal error` outward, with the full text written to the internal
  log keyed by `requestId`. Absolute filesystem paths are scrubbed from any outward message as a
  belt-and-suspenders measure. `resources/read` for a missing or empty resource now raises
  `ResourceNotFoundError` (`-32002`) instead of a generic `-32603`.
- **`ValidationError` now carries an explicit `-32602`** (was implicitly `-32000`), matching the
  public-contract table. This also marks its (developer-authored) message as safe so it survives
  the new sanitization instead of collapsing to `Internal error`. Generic `ServerError` /
  `ToolExecutionError` without an explicit code remain `-32000` and now sanitize to `Internal
  error` outward — wrap raw upstream failures in `UpstreamUnavailableError` (or another explicit
  class) when the message must reach the client.

### `[BEHAVIOUR]`

- **WI-1 (§8.2): conditional `prompts` capability.** A server configured without agent briefs and
  without `customPrompts` no longer advertises `capabilities.prompts`, and its `prompts/*` methods
  return `-32601`. Servers with prompts (the typical case — `agent_brief` / `agent_prompt`) are
  unaffected. `tools` and `resources` remain always advertised (built-in resources exist in every
  configuration). Downstream tests that asserted `capabilities.prompts` on a prompt-less server
  must be updated.
- **WI-2 (§13.3): generic text for internal errors.** The `error.message` of an unexpected internal
  error is now `Internal error` over the wire (full detail in the internal log by `requestId`).
  Downstream tests asserting the exact text of an internal error in an MCP response must be updated
  — such an assertion was itself a §13.3 violation.

### Config schema

- Added `mcp.completions.enabled` (with the `MCP_COMPLETIONS_ENABLED` env-var override) and `AppConfig`.

### Tests

- New suites cover the `completions` capability, outward error sanitization, binary resources, and
  the new error codes (npm scripts `test:capabilities`, `test:error-sanitize`, `test:binary-resource`,
  `test:error-codes`, `test:completions`).

## [0.8.1] - 2026-05-29

Phase 4 — Observability + Contract stability. Closes the §15 / §17 / §8.5 / §8.6 / §15.1 /
§15.2 / §15.3 / §17.1 / §17.2 gaps in the MCP server implementation standard
(WI-1 … WI-12). The
release is additive — every new capability is either always-on but backwards compatible, or
opt-in via configuration. A single `[BEHAVIOUR]` change is called out below.

### Added

- **`X-Request-Id` middleware** (WI-1, §15.1). New middleware carries a
  sticky correlation id end-to-end via `AsyncLocalStorage`:
  - reads `X-Request-Id` from the request (8-128 visible-ASCII chars), or mints a UUID;
  - always sets the header on the response (see `[BEHAVIOUR]` below);
  - surfaces the id under `error.data.requestId` for every JSON-RPC error response;
  - flows into the JSON-lines debug sink (`emitTrace`) as `requestId`.
- **W3C trace context** (WI-2, §15.1). The middleware also parses `traceparent` /
  `tracestate` (per `https://www.w3.org/TR/trace-context/`). Valid contexts surface as
  `trace_id` / `span_id` in trace events; `tracestate` is echoed back unchanged on the
  response.
- **Stdio per-message context** (WI-3, §15.1). Every JSON-RPC handler runs inside an
  `AsyncLocalStorage` scope with `requestId: stdio-<uuid>` so logs / errors / notifications
  share a correlation id end-to-end on stdio just like on HTTP.
- **`logging` capability + `notifications/message`** (WI-4, §15.2 + §8.2). The server
  advertises `logging: {}` on initialize (opt-out via `mcp.logging.enabled = false`),
  accepts `logging/setLevel`, and exposes `sendLoggingMessage()` for emitting events. The
  threshold (Syslog ladder) defaults to `info` (`mcp.logging.defaultLevel`); payloads larger
  than `mcp.logging.maxBodyBytes` (4 KiB by default) are truncated.
- **Prometheus metrics** (WI-5, §15.3). A private
  `prom-client` registry is exposed. Endpoint `GET /metrics` (configurable path) is mounted when
  `webServer.metrics.enabled = true` (default `false`). Series:
  - `mcp_tool_calls_total{tool,status}`
  - `mcp_tool_duration_seconds{tool}`
  - `mcp_auth_failures_total{reason}`
  - `mcp_rate_limit_hits_total{scope}`
  - `mcp_http_requests_total{method,path,status}`
  - `mcp_concurrent_calls{subject}`
  - `mcp_payload_bytes`, `mcp_result_bytes`
  - plus Node.js process metrics when `includeProcessMetrics` is `true` (default).
  Dependency: `prom-client@^15`.
- **Cancellation `AbortSignal`** (WI-6, §8.5). `IToolHandlerParams.signal?: AbortSignal` is
  now propagated from the SDK transport to every tool handler. Long-running operations
  should pass it to downstream APIs (`fetch`, `pg`, …).
- **`notifications/progress`** (WI-7, §8.6). `IToolHandlerParams.sendProgress?` is wired
  whenever the request carries `_meta.progressToken`. Emissions are server-side throttled
  by `mcp.progress.throttleMs` (default 100 ms / 10 events/s/token) and forced monotonic.
  Calls without a `progressToken` get a no-op so handlers can call `sendProgress` blindly.
- **Deprecation lifecycle** (WI-9, §17.2). A new module reads a
  structured `IDeprecationInfo` block from `_meta.deprecated` (tools) or a top-level
  `deprecated` field (prompts / resources). At list time the description is prefixed with
  `[DEPRECATED until YYYY-MM-DD, use <replacement>]`; at call time the SDK emits a
  `logger.warn` rate-limited to one event per hour per `(kind, name)`. Past-due `until`
  dates raise a `logger.error` on registration.
- **New configuration keys**:
  - `mcp.logging.{enabled,defaultLevel,maxBodyBytes}`
  - `mcp.progress.throttleMs`
  - `webServer.metrics.{enabled,path,includeProcessMetrics}`
  All four blocks default to safe-additive values; existing configs continue to load
  without edits.
- **Type extensions**:
  - `IDeprecationInfo`
  - `IToolHandlerParams.signal`, `IToolHandlerParams.sendProgress`
  - `IPromptData.deprecated`, `IResourceInfo.deprecated`
- **Tests** — new suites cover the `X-Request-Id` middleware, the deprecation lifecycle, and
  Prometheus metrics. Wired so that a single suite runs directly after `npm run build`.

### Changed [BEHAVIOUR]

- Every HTTP response now carries an `X-Request-Id` header (generated when the client did
  not supply one). Downstream tests that assert on the *absence* of the header must be
  updated. This is the only behavioural change in 0.8.x.

### Compatibility

- No removed or renamed exports.
- No tightened config validation.
- `prom-client` is a new direct dependency (~70 KB) — required even when metrics are
  disabled, but it is not initialised until `webServer.metrics.enabled = true`.

### Migration

```bash
# No code or config changes required:
npm install fa-mcp-sdk@^0.8.0
npm run typecheck    # must remain green
```

To opt-in to the new observability surface:

```yaml
# config/local.yaml
webServer:
  metrics:
    enabled: true
    path: '/metrics'
mcp:
  logging:
    enabled: true        # default
    defaultLevel: info   # default
  progress:
    throttleMs: 100      # default
```

Metrics endpoint is unauthenticated by design (standard §16) — protect via network policy
or reverse proxy when the server is reachable from the outside.

## [0.7.0] - 2026-05-28

Phase 3 — Auth profile (RS256/ES256 + JWKS + MCP Authorization). Closes the §7 /
§7.3 / §7.4 / Прил. A gaps in the MCP server implementation standard
(WI-A1…A4 + WI-B1…B6). Cherry-picks the cryptography stack from the `JWKS` branch
(commit `a5ed245`) and layers on the validation, scope-enforcement, rate-limit,
and `/ct` hardening that the standard requires on top of it.

### Added

- **Four-mode JWT runtime** (WI-A1/A2, §7.2 / Прил. A.1). New
  `webServer.auth.jwtToken.mode`:
  - `legacyAesCtr` (default) — HS256 issue + legacy AES-CTR read. Bit-for-bit parity
    with 0.6.x for downstream servers that have not yet migrated.
  - `embedded` — ES256/RS256 with a built-in IdP: auto-generates a keypair in
    `keyStoragePath`, publishes JWKS at `/.well-known/jwks.json`, exposes
    `POST /oauth/token` (grant_type=password).
  - `localKey` — ES256/RS256 verifying against `publicKeyPath`; optional
    `privateKeyPath` enables local issuance via the JWT generation script / `/gen-jwt`.
  - `remoteJwks` — ES256/RS256 verify against an external IdP's
    `jwksUri` (with `jwksCacheTtl` + `jwksCooldown`); the server refuses to issue
    tokens itself.
- **`jose@^5.10.0`** added to `dependencies` as the JWT engine for non-legacy modes.
  `jsonwebtoken` remains for `legacyAesCtr`.
- **Key resolver** — uniform `KeyResolver` interface with
  `Embedded` / `Local` / `RemoteJwks` implementations, `getJwtRuntimeConfig()`,
  `canLocallyIssueJwt()`, `buildLocalJwks()`.
- **JWT v2 engine** — `generateTokenV2()` / `verifyJwtV2()` based on
  `jose` (`SignJWT` + `jwtVerify`), respecting `expectedIssuer` / `expectedAudience` /
  `clockSkew`.
- **OAuth / OIDC discovery endpoints** (WI-A3, §7.3) — mounted automatically when
  `mode !== 'legacyAesCtr'`:
  - `GET /.well-known/oauth-protected-resource` (any non-legacy mode, RFC 9728).
  - `GET /.well-known/openid-configuration` (`embedded` / `localKey`, OIDC Discovery 1.0).
  - `GET /.well-known/jwks.json` (`embedded` / `localKey`).
  - `POST /oauth/token` (`embedded` + `localKey` with private key, grant_type=password).
  Express `trust proxy` honours `webServer.trustProxy` so the issuer URL stays correct
  behind HTTPS reverse proxies.
- **Pre-flight start-up validation** (WI-B1, Прил. A.1 / §7.2). `initMcpServer` now
  throws when `remoteJwks` has no `jwksUri`, `localKey` has no `publicKeyPath`,
  non-legacy modes have no `expectedIssuer`, or `clockSkew > 60s`. Production +
  `legacyAesCtr` now emits a warning instructing the operator to migrate to
  RS256/ES256.
- **`WWW-Authenticate` on every 401** (WI-A2 + WI-B2, §7.4). Header now carries
  `realm="<appConfig.name>"`, plus `resource_metadata="…/.well-known/oauth-protected-resource"`
  in non-legacy modes. When a token verified-but-failed (e.g. expired) the header
  adds `error="invalid_token", error_description="…"` per RFC 6750.
- **HTTP 403 for authorization failures** (WI-B3, §7.4 / §7.5). New
  `AuthResult.forbidden` flag distinguishes "no creds" (401 + challenge) from
  "creds OK but lacks permission" (403, no challenge). Custom validators may now
  return `forbidden: true`.
- **Scope enforcement** (WI-B5, §7.5):
  - `IResourceData.requiredScopes` / `IPromptData.requiredScopes`. The auth middleware
    rejects `resources/read` / `prompts/get` whose target declares scopes the token
    does not carry, returning 403.
  - Tool dispatch reads `tool._meta.requiredScopes`
    (or `tool.requiredScopes`) and raises JSON-RPC `-32004` with
    `data.missing` on insufficient scope.
  - `use://auth` now publishes the full server-side `requiredScopes` map for tools,
    prompts, and resources, plus the live `jwt.mode` / `jwt.algorithm` /
    `discovery.*` URLs.
- **Per-subject rate limit + max concurrent in-flight `tools/call`** (WI-B6, §14):
  - `mcp.rateLimit.scope` (`'subject'` default | `'ip'`). Subject = JWT `sub`/`user`
    with IP fallback when auth is disabled.
  - `mcp.rateLimit.maxConcurrentPerSubject` (default 16). Exceeded → `RateLimitedError`
    (`-32003`/HTTP 429 + `Retry-After`).
- **JWT generation script** — mode-aware. `legacyAesCtr`
  keeps HS256; `embedded` / `localKey` sign with ES256/RS256 from keystore.
  `remoteJwks` exits with a helpful error pointing at the configured IdP.
- **Test suites** (WI-A4):
  - embedded sign/verify (ES256/RS256), tamper, expiry, `remoteJwks` issue refusal.
  - `/.well-known/*`, `POST /oauth/token` success + grant/credential rejections,
    `WWW-Authenticate` shape on 401.
  - server.auth × useAuth matrix; per-mode refresh endpoint behaviour.
  - proactive refresh, expired-token 401, retry-on-401.
  - a shared spawn-and-await harness.

### Changed

- **`generateToken()` / `checkJwtToken()` are now `async`** (WI-A2, `[BREAKING]`).
  Both dispatch through `getJwtRuntimeConfig().mode`. Legacy synchronous behaviour is
  still available via the explicit exports `generateTokenLegacy` /
  `checkJwtTokenLegacy`. All in-tree callers were migrated.
- **`getAuthHeadersForTests()` is now `async`** (`[BREAKING]`). Uses
  `canLocallyIssueJwt()` so JWT-based test headers work in every mode that can
  sign locally (not just legacy with `encryptKey`).
- **`/gen-jwt` in `remoteJwks` mode** returns HTTP 501 with `cannot_issue_token`,
  pointing at the configured IdP.
- **`GET /ct?t=<token>` is disabled by default** (WI-B4, §7.1, `[BREAKING]`).
  Standard §7.1 forbids secrets in URL query strings. The endpoint now answers
  HTTP 405; tokens must be posted to `POST /ct` with JSON body. The opt-in
  `webServer.tokenCheck.allowQueryToken: true` re-enables the legacy form for
  non-production deployments (the flag is ignored when `NODE_ENV=production`).
- **Auth profile (`use://auth`)** now includes `jwt.{mode,algorithm,expectedIssuer,
  expectedAudience,jwksUri}`, the live `discovery.*` URLs, and a `requiredScopes`
  snapshot.

### Configuration

Schema additions (with matching env-var overrides, mirrored in `IWebServerConfig` /
`IMCPConfig`):

```yaml
webServer:
  trustProxy: false       # boolean | string | number — Express trust proxy
  tokenCheck:
    allowQueryToken: false   # standard §7.1 — POST /ct only by default
  auth:
    jwtToken:
      mode: legacyAesCtr
      algorithm: ES256
      keyStoragePath: './keys'
      publicKeyPath: ''
      privateKeyPath: ''
      jwksUri: ''
      expectedIssuer: ''
      expectedAudience: ''
      jwksCacheTtl: 600
      jwksCooldown: 30
      clockSkew: 30
      defaultTtl: 1800
mcp:
  rateLimit:
    scope: subject              # 'subject' | 'ip'
    maxConcurrentPerSubject: 16
```

New ENV overrides: `WS_JWT_MODE`, `WS_JWT_ALGORITHM`, `WS_JWT_KEY_STORAGE_PATH`,
`WS_JWT_PUBLIC_KEY_PATH`, `WS_JWT_PRIVATE_KEY_PATH`, `WS_JWT_JWKS_URI`,
`WS_JWT_EXPECTED_ISSUER`, `WS_JWT_EXPECTED_AUDIENCE`, `WS_JWT_JWKS_CACHE_TTL`,
`WS_JWT_JWKS_COOLDOWN`, `WS_JWT_CLOCK_SKEW`, `WS_JWT_DEFAULT_TTL`,
`WS_TOKEN_CHECK_ALLOW_QUERY`, `WS_TRUST_PROXY`, `MCP_RATE_LIMIT_SCOPE`,
`MCP_RATE_LIMIT_MAX_CONCURRENT_PER_SUBJECT`.

### Migration (0.6.x → 0.7.0)

`[BREAKING]` items in summary:

1. `generateToken()` / `checkJwtToken()` are async. Add `await` at every call site —
   or import `generateTokenLegacy` / `checkJwtTokenLegacy` if synchronous behaviour
   is mandatory (legacy-mode only).
2. `getAuthHeadersForTests()` is async. Add `await`.
3. `GET /ct?t=<token>` is disabled by default. Switch clients to
   `POST /ct {"t":"<token>"}` or opt in via `webServer.tokenCheck.allowQueryToken`
   (ignored in production).
4. Auth profile schema gains the four-mode `jwtToken.mode`. Existing configs continue
   to work unchanged (default `legacyAesCtr`); production deployments are encouraged
   to migrate to `mode: remoteJwks` or `mode: localKey`.

Example for moving to a corporate IdP:

```yaml
webServer:
  auth:
    enabled: true
    jwtToken:
      mode: remoteJwks
      jwksUri: 'https://idp.corp/.well-known/jwks.json'
      expectedIssuer: 'https://idp.corp'
      expectedAudience: '<mcp-server-name>'
      jwksCacheTtl: 600
      clockSkew: 30
```

A dev-friendly variant with the built-in IdP:

```yaml
webServer:
  auth:
    enabled: true
    jwtToken:
      mode: embedded
      algorithm: ES256
      keyStoragePath: './keys'
```

## [0.6.0] - 2026-05-28

Phase 2 — Tools / Prompts / Resources contract. Closes P1 gaps against the MCP server
implementation standard (WI-1 … WI-10; standard chapters §8.4, §9, §10, §11, §12).

### Added

- **`arguments` validation against `inputSchema`** (WI-1, §9.3). Each tool's
  `inputSchema` is now compiled via `ajv` (draft
  2020-12 + `ajv-formats`). Invalid `tools/call` arguments return JSON-RPC `-32602`
  with `error.data.field` and `error.data.reason` (e.g. `"limit"` /
  `"must be number"`). The domain `toolHandler` is no longer called.
- **`outputSchema` validation + `structuredContent` mirroring** (WI-4, §9.4, §12.4).
  When a tool declares `outputSchema`, the server validates `structuredContent` against it
  after the handler returns; violations surface as JSON-RPC `-32603`. Whenever
  `structuredContent` is present, the serialised JSON is mirrored into `content[0].text`
  so legacy clients keep working without code changes.
- **snake_case enforcement for tool names** (WI-2, §9.1). `initMcpServer()` fails fast
  on static tool arrays when a name does not match `/^[a-z][a-z0-9_]{0,62}$/`; dynamic
  (function-form) tools are validated on first `getTools()` call.
- **Parameterised prompts** (WI-6, §10.5) `[BEHAVIOUR]`. `IPromptData.arguments` now
  accepts the standard `Array<{ name, description?, required? }>` descriptor. The prompt
  content function signature is extended with an optional second argument receiving
  `request.params.arguments`; old single-arg functions remain compatible.
- **Built-in resources** (WI-7, WI-8, §4 / §11.2):
  - `project://version` (`text/plain`) — mirrors `serverInfo.version` and `/health.version`.
  - `use://auth` (`application/json`) — enabled auth schemes, methods, expected JWT claims.
  - `<appConfig.name>://agent/brief` and `<appConfig.name>://agent/prompt` — service-scheme
    mirrors of the `agent_brief` / `agent_prompt` prompts (Avatar profile §11.2). Project
    `customResources` with the same URIs override the built-in mirror.
- **`title` field** in template tools (WI-5, §9.1). Generated projects now ship with
  human-readable `title` on every example tool.
- **Schemas in template tools use draft 2020-12** (WI-3, §9.2). `getGenericInputSchema` and
  `getSearchInputSchema` set `$schema: 'https://json-schema.org/draft/2020-12/schema'`,
  `additionalProperties: false`, and explicit `required`. `IToolInputSchema` extended with
  optional `$schema` and `additionalProperties`.
- **Optional `resources/templates/list` and `resources/subscribe`** (WI-9, MAY §11.5).
  Disabled by default. Opt-in via `mcp.resources.subscribeEnabled` /
  `mcp.resources.templatesEnabled`. When `subscribeEnabled: true`, the server advertises
  `subscribe` + `listChanged` capabilities and exposes `notifyResourceUpdated(server, uri)`
  for project code to broadcast updates. Project-supplied templates live in
  `McpServerData.customResourceTemplates`.
- **Server-side pagination** (WI-10, §8.4) for `tools/list`, `prompts/list`,
  `resources/list`. Cursor is opaque base64(offset); items are sorted stably by `name` /
  `uri`. Page size configurable via `mcp.pagination.pageSize` (default 100). Invalid
  cursors return JSON-RPC `-32602` with `error.data.field: 'cursor'`.
- **Dependencies:** `ajv@^8.20`, `ajv-formats@^3.0` added to runtime dependencies (~150 KiB
  gzipped). Used by WI-1 / WI-4.

### Changed

- **`mcp.resources` and `mcp.pagination` config blocks** added (with matching env-var overrides).
  Defaults preserve the previous behaviour (`subscribeEnabled: false`, `templatesEnabled: false`,
  `pageSize: 100`).

### Compatibility

Only WI-6 is marked `[BEHAVIOUR]` — user-defined prompts with non-empty `arguments` now
appear in `prompts/list` and may receive `request.params.arguments`. Static prompts
remain unchanged. All other changes are additive. Version bumped to **0.6.0** (MINOR).

## [0.5.0] - 2026-05-28

Phase 1 HTTP hardening package — closes MUST-level gaps against the MCP server implementation standard
(ch. §4, §6, §12–§16, Appendix B).

### Added

- **`mcp.limits` config section.** Three hard ceilings now configurable per environment
  (with matching env-var overrides):
  - `mcp.limits.maxPayloadBytes` — max accepted JSON / urlencoded request body. Default **1 MiB**
    (was a hardcoded 10 MiB). Above the limit: JSON-RPC `-32005` + HTTP **413**.
  - `mcp.limits.maxToolResultBytes` — max serialized tool result. Default **10 MiB**. Above the limit:
    payload is truncated with an explicit marker (`…[truncated]` in `content[].text`, and
    `structuredContent.truncated: true`).
  - `mcp.limits.toolTimeoutMs` — per-tool execution timeout. Default **30 000 ms** (30 s). Above the
    limit: JSON-RPC `-32004` + HTTP **504** on `/mcp`.
- **Specific error factories:**
  `PayloadTooLargeError` (-32005/413), `TimeoutError` (-32004/504), `RateLimitedError` (-32003/429),
  `ResourceNotFoundError` (-32002/404), plus the `MCP_ERROR_CODES` map. Exported from the SDK root.
- **`error.data` is now structured** per standard Appendix B.3 — `{ requestId?, field?, reason?,
  retryAfter? }` plus open-ended extensions. Stack traces and internal paths are NEVER copied into
  `error.data` (standard §13.3). `createJsonRpcErrorResponse(err, requestId?, extraData?)` accepts an
  optional third `extraData` argument for transport-side enrichment (e.g., `requestId`).
- **`GET /ready` readiness probe** — no authentication required. Reports per-dependency status
  (`db` / `cache` / `jwks`) reduced to `ok` / `error` / `skipped`; never returns sensitive details.
  HTTP **200** when all dependencies are ready, **503** otherwise. Standard §16.2.
- **`/health` body now includes `version` and `uptime`** as required by standard §16.1. HTTP status
  becomes **503** when `status === 'unhealthy'` (was always 200).
- **Tool timeout enforcement.** New module with `withToolTimeout` and
  `truncateToolResponse`. Wraps the tool handler on both HTTP (Streamable + legacy SSE) and STDIO
  transports. The HTTP `/mcp` POST also runs a parallel race for `tools/call` so HTTP 504 is delivered
  even when the SDK transport would otherwise return 200 with the JSON-RPC error inside.
- **CORS hard-reject middleware.** A second middleware after `cors()` converts the previously generic
  500 (from the CORS callback rejecting) into a structured **403 Forbidden** with JSON-RPC body.

### Changed

- **[BREAKING] Rate-limit response shape** (`/mcp`, `/sse`, `/messages`). The server now follows
  standard §14 / Appendix B:
  - HTTP status: **`200 OK` → `429 Too Many Requests`**
  - JSON-RPC code: **`-32000` → `-32003`**
  - Adds **`Retry-After`** HTTP header (seconds) and mirrors the same value under
    `error.data.retryAfter`.
- **[BREAKING] Legacy SSE "session not found" / "no connection" responses** on `POST /messages` and
  `POST /sse` now use JSON-RPC code **`-32002`** (was `-32001`); HTTP status stays **`404 Not Found`**.
- **CORS now actually rejects unlisted origins.** The previous implementation called
  `callback(null, true)` in *both* branches, effectively allowing every `Origin`. Requests whose
  `Origin` is not covered by `webServer.originHosts` now get HTTP **403** + JSON-RPC error
  (`{ data: { reason: 'origin_not_allowed' } }`). Same-origin requests (no `Origin` header) keep
  passing through.
- **Production refuses an empty CORS allow-list.** `initMcpServer()` aborts startup in production
  (`NODE_ENV === 'production'`) when `webServer.originHosts` is empty or missing. Dev/test environments
  log a warning instead.
- **Default HTTP bind address is now loopback (`127.0.0.1`)** (was `0.0.0.0`).
  Containers and public-facing deployments must opt in to `0.0.0.0`
  explicitly. The `app.listen()` call now honours `appConfig.webServer.host` instead of hardcoding
  `0.0.0.0`. Standard §6.
- **Body size limit driven by config.** `express.json` / `express.urlencoded` no longer use
  hardcoded `'10mb'`; both read `mcp.limits.maxPayloadBytes` and the `entity.too.large` Express error
  is converted to JSON-RPC `-32005` + HTTP 413 instead of leaking the default HTML page.
- **`BaseMcpError` constructor extended.** New optional parameters `jsonRpcCode` (number) and `data`
  (`IMcpErrorData`). Legacy `details` continues to work as a fallback when no `data` is supplied.
  `toJSON()` emits `data` alongside `details`.

### Migration

- Existing servers that read `webServer.host` from config keep working. Projects that relied on the
  implicit `0.0.0.0` bind from this SDK need to set `webServer.host: '0.0.0.0'` in their own config
  (containers, docker-compose, k8s).
- Clients reading the legacy `code: -32000` rate-limit response or `code: -32001` SSE session error
  must be updated to the new codes (`-32003`, `-32002`). The new `Retry-After` header is now
  authoritative for backoff scheduling.
- Tools whose execution legitimately exceeds 30 s must override `mcp.limits.toolTimeoutMs` in
  config. Tools whose results legitimately exceed 10 MiB must override
  `mcp.limits.maxToolResultBytes`. The standard considers both as legitimate per-server overrides.

