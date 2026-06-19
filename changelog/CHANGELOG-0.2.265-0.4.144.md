# Changelog archive — versions 0.2.265 through 0.4.144

Archived entries split out of the main [CHANGELOG.md](../CHANGELOG.md) for progressive disclosure.
Covers releases from 0.4.144 (2026-05-27) down to the earliest recorded release. Newest first.

## [0.4.144] - 2026-05-27

### Changed

- **Streamable HTTP `/mcp` now runs on the SDK transport (BREAKING).** The hand-rolled `switch(method)`
  router was replaced with `@modelcontextprotocol/sdk`'s
  `StreamableHTTPServerTransport`, driving the same `Server` instance as STDIO (one code path). Each
  MCP session is **stateful** — its own `Server` + transport, keyed by a server-generated
  `Mcp-Session-Id`, stored in an in-memory `Map` with a FIFO soft cap (`MAX_HTTP_SESSIONS = 4096`) and
  cleanup on session close. This brings, from the SDK:
  - **Protocol negotiation** — `initialize` now answers the negotiated version (`2025-11-25` for
    up-to-date clients) instead of the previously hardcoded `2024-11-05`.
  - **`GET /mcp`** (server→client SSE stream) and **`DELETE /mcp`** (explicit session teardown).
  - **`notifications/*` → HTTP 202** (was 204); standard JSON-RPC error codes from the transport.
  - **400** for a non-`initialize` request without a valid session.
- **`createMcpServer(transportType)` now takes a transport argument** and builds handler context from
  the SDK per-request `extra` (`requestInfo.headers`, `authInfo`) instead of a STDIO-only context.
  `params.clientCapabilities` is now read from each session's own `Server.getClientCapabilities()`
  (no separate capabilities cache).
- **`McpStreamableHttpClient` rewritten over the SDK client (BREAKING).** It now wraps
  `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`, which handles
  `Accept: application/json, text/event-stream`, `Mcp-Session-Id` capture/resend, version negotiation
  and `DELETE`-on-close. Removed the bespoke `sendRpc` / `notify` / `onNotification` methods; the
  `BaseMcpClient` surface (`listTools`, `callTool`, `getPrompt`, `listResources`, `readResource`, …)
  is unchanged.
- **`McpHttpClient` is now a deprecated thin alias** of `McpStreamableHttpClient`. The old plain-POST
  client was incompatible with the SDK server transport (missing `Accept`/session handling).

### Added

- **HTTP auth bridge `req.auth`.** `createAuthMW` now also sets `req.auth` (alongside `req.authInfo`)
  so the SDK transport surfaces the auth result to handlers as `extra.authInfo` → `params.payload`.

### Notes

- Auth, rate limiting and the request body-size limit remain Express middleware **before** the SDK
  transport, so their behaviour is unchanged.
- `ping` is now handled by the SDK `Server` and returns an empty result `{}` (previously the
  hand-rolled router returned `{ pong: true }`).

## [0.4.139] - 2026-05-20

### Added

- **Agent Tester "Remember me" login.** Both authentication forms (token and basic) gained a "Remember me on this
  device" checkbox (checked by default). When enabled, credentials are persisted to `localStorage` under
  `agentTesterAuthCreds` and reused for a silent re-login on subsequent visits, bypassing the login overlay entirely
  while the credentials remain valid. On failed silent re-login the saved entry is cleared and the overlay is shown
  with fields pre-filled from the last saved values (the **basic** tab is auto-selected when only `username`/`password`
  were saved). Logout and any authentication-failure response also clear the saved credentials. New private API on
  `AuthManager`: `_loadSavedCreds`, `_saveCreds`, `_clearSavedCreds`, plus `silent` and `remember` options on
  `_login(credentials, opts)`.

### Changed

- **Agent Tester settings modal — explicit OK button.** The modal now has a footer with a primary **OK** button
  (`#settingsModalOk`) that closes the dialog. The previous click-outside-to-close behavior was removed to prevent
  accidental dismissal while editing settings; **Escape** still closes the modal.
- **Agent Tester logout button styling.** `#logoutBtn` is rendered in the error color (`var(--error)`) and uses the
  error background on hover, making the destructive action visually distinct from neighboring toolbar buttons.

## [0.4.131] - 2026-05-19

### Added

- **JSON-lines debug sink (`mcp.debug.logFile`).** Set the config key (or
  `MCP_DEBUG_LOG_FILE` env) to an absolute path and every `mcp:tool` /
  `mcp:resource` / `mcp:prompt` event is additionally appended as one JSON
  object per line — `{ts, ch, kind, ...}`. The existing `DEBUG=mcp:*` stderr
  stream is unchanged; the sink is purely additive and designed for
  post-mortem analysis (`jq` for p95 latency, error mining, widget-event
  filtering). Each `mcp:tool` line carries an 8-char `corr` ID that pairs
  `req` with its matching `res`/`err`, plus per-call `ms` latency. New public
  exports: `emitTrace()`, `configureDebugSink()`, `initDebugTraceFromConfig()`
  so user code (handlers, background jobs) can write into the same channel.
- **Built-in MCP debug tools (`mcp.debug.builtinTools`).** New flag registers
  three SDK-provided tools, all marked `_meta.ui.visibility: ['app']` so MCP
  App hosts hide them from the LLM:
  - `mcp-debug-log` — widget pushes a structured event into the JSON-lines
    sink (and `DEBUG=mcp:*` stream) via `app.callServerTool(...)`, removing
    the need to ship a logger / fetch client / JWT inside the View.
  - `mcp-debug-refresh` — widget reads back lightweight server state
    (`{ timestamp, counter }`) without involving the LLM, for polling /
    heartbeat scenarios.
  - `debug-tool` — universal test fixture that produces every variation of
    `CallToolResult` (text / image / audio / resource / resourceLink / mixed,
    single vs. multi-block, `structuredContent` and `_meta` toggles,
    `isError: true`, `delayMs` for timeout tests, `largeInput` for
    truncate/streaming tests). Removes the need to write bespoke fake
    servers for client-side integration tests (Agent Tester, custom MCP
    hosts, CI smoke tests).

  New exports: `BUILTIN_MCP_DEBUG_TOOLS`, `BUILTIN_MCP_DEBUG_TOOL_NAMES`,
  `MCP_DEBUG_LOG_TOOL_NAME`, `MCP_DEBUG_REFRESH_TOOL_NAME`,
  `handleBuiltinDebugTool`, `isBuiltinDebugTool`, `DEBUG_TOOL`,
  `DEBUG_TOOL_NAME`, `handleDebugTool`, `registerDebugTool` (structural
  helper that attaches `debug-tool` to any `McpServer` with a
  `registerTool(name, def, handler)` method, so the SDK does not pull in a
  hard dependency on `@modelcontextprotocol/sdk/server/mcp.js`).
- **Canonical MCP Apps example.** A new canonical example
  (server + single-file widget + README) is now part of every
  generated project; `npm run example:mcp-apps` (runs via
  `cross-env WS_PORT=7080 tsx`) starts the example
  server on port 7080 and is the documented reference for the
  `mcp-app-create` and `mcp-app-add-to-server` skills. Demonstrates the three
  patterns to copy: `tools[i]._meta.ui.resourceUri`, `customResources[i]`
  with `mimeType: MCP_APPS_RESOURCE_MIME_TYPE`, and the `ui/initialize` →
  `ui/notifications/initialized` → `ui/notifications/tool-result` widget
  handshake. Uses `fa-mcp-sdk`'s `initMcpServer` + `customResources`
  pipeline (not `registerAppTool` from `@modelcontextprotocol/ext-apps`) so
  it inherits the same auth, transport, logging, and debug plumbing as the
  rest of the server.

### Changed

- `wrapProjectDataWithDebug()` now generates a `corr`
  ID at call entry and emits `{kind: 'req'|'res'|'err', name, args?, ms?,
  corr}` events into the JSON-lines sink in addition to the existing
  `debugMcpTool` stderr writes. When `mcp.debug.builtinTools=true`, the
  wrapper also routes calls to `mcp-debug-log` / `mcp-debug-refresh` /
  `debug-tool` to their SDK-internal handlers before falling back to the
  user-supplied `toolHandler`. The same `emitTrace` hooks landed in the
  resource handlers (`list-req` / `list-res` / `read-req` / `read-res` /
  `read-err`) and the prompt handlers (`list-req` / `list-res` / `get-req` /
  `get-res` / `get-err`). All hooks are no-ops when neither `DEBUG=mcp:*`
  is set nor `mcp.debug.logFile` is configured.

## [0.4.130]

### Added

- **Tool-level error helpers (`isError: true`).** New exports `formatToolError()`, `asTextError()`,
  `asJsonError()` mirror `formatToolResult()` / `asTextContent()` / `asJson()` but set
  `isError: true` on the MCP `tools/call` result. This is the spec-recommended way to surface
  recoverable failures (resource not found, business validation, upstream 4xx) — the LLM sees the
  error text inside the conversation and can self-correct, instead of receiving a JSON-RPC
  protocol error that most clients treat as a hard sandbox failure. `IToolHandlerTextResponse`
  and `IToolHandlerStructuredResponse` now carry an optional `isError?: boolean` field.

## [0.4.122]

### Added

- **Built-in MCP debug switches.** Four independent `af-tools-ts` `Debug()` categories trace every MCP channel; both HTTP and STDIO transports route through the same hooks so output is transport-agnostic.
  - `DEBUG=mcp:tool` — `tools/call` request (name + arguments) and response (text or JSON). Wired up via a `toolHandler` wrapper so it intercepts the user-supplied handler once and covers every transport.
  - `DEBUG=mcp:resource` — `resources/list` and `resources/read` request/response.
  - `DEBUG=mcp:prompt` — `prompts/list` and `prompts/get` request/response.
  - `DEBUG=mcp:notification` — every incoming `notifications/*` (method + params).
  - `DEBUG=mcp:*` enables all four at once.
- New exports from `fa-mcp-sdk`: `debugMcpTool`, `debugMcpResource`, `debugMcpPrompt`, `debugMcpNotification` (and the pre-existing `debugTokenAuth`), so handlers can guard custom debug output with `if (debugMcpTool.enabled) { ... }`.
- The template tool handler now demonstrates the `if (debugMcpTool.enabled)` pattern for per-handler tracing inside user code.

### Changed

- **Agent Tester UI redesign (commit `ff8916e`).** The left sidebar that held connection, model, agent-prompt and custom-prompt panels has been removed; all of those controls now live in a Settings modal opened by a gear button (`#settingsBtn`, `data-testid="at-settings-btn"`) in the header. The MCP Server URL field, transport selector and a new combined Connect/Disconnect button (`#connectionToggleBtn`, `data-testid="at-connect-btn"`) sit directly in the header, along with the tab bar (Chat / Tool Tester) — the chat area now uses the full viewport width. The dedicated `Connect` button, `sidebar`/`sidebarToggleMobile` markup and their JS handlers (`toggleSidebar`) are gone; the new flow is `openSettingsModal()` / `closeSettingsModal()` (Esc + backdrop click close it) and a single submit handler on `mcpConnectionForm` that calls `disconnectServer()` when already connected. The `Clear Chat` and default-format selector were marked `.chat-only` so they hide on the Tool Tester tab. The stylesheet was rewritten to support the new header layout and modal styling.
- Minor refactor in the MCP Apps helpers: `getUiCapability()` now uses `isObject()` from `utils` instead of an inline `typeof === 'object'` check (same semantics, consistent with the rest of the codebase). The barrel re-orders the `appConfig` / `getProjectData` / `getSafeAppConfig` export block ahead of the MCP Apps helpers — purely cosmetic.

## [0.4.112] - 2026-05-18

### Added

- Add a helper to restore executable bits on bundled helper scripts.
- Add a preferred-language marker so generated projects default project guidance to English.

### Changed

- Rename the Codex skill-link helper.
- Point the `agents:link*` scripts and the SDK update helper at the renamed helper in generated projects.

## [0.4.110] - 2026-05-17

### Added

- **MCP Apps support — client capability propagation** (SEP-1865). `IToolHandlerParams.clientCapabilities` and `ITransportContext.clientCapabilities` are now populated on every call so handlers can branch UI-augmented vs. text-only output without giving up the upstream MCP Apps text-fallback contract.
  - STDIO: `Server.getClientCapabilities()` is read inside every `tools/list`, `tools/call`, `prompts/list`, `prompts/get`, `resources/list`, `resources/read` handler in `createMcpServer()`.
  - SSE: `sseServer.getClientCapabilities()` is read on every dispatched call (lazy via the new `sseCtx()` closure) — the per-connection MCP server already holds capabilities after handshake.
  - Streamable HTTP: capabilities reported on `initialize` are cached in an in-memory `Map` keyed by the `Mcp-Session-Id` header (soft FIFO cap of 4096 sessions, oldest evicted first). Subsequent stateless POSTs from the same session receive the cached value; sessions without the header get `undefined` (handler MUST fall back to text-only).
- New type `IClientCapabilities = ClientCapabilities & { extensions?: Record<string, unknown> }` re-exported from `fa-mcp-sdk` — covers the open-ended `extensions` envelope MCP Apps and future SEPs publish alongside the standard fields.
- New helpers `getUiCapability(clientCapabilities)`, `hostSupportsMcpApps(clientCapabilities)`, `MCP_APPS_EXTENSION_ID`, `MCP_APPS_RESOURCE_MIME_TYPE`, and type `IMcpUiClientCapabilities` exported from `fa-mcp-sdk`. Mirror of `@modelcontextprotocol/ext-apps/server`'s `getUiCapability` / `RESOURCE_MIME_TYPE` / `EXTENSION_ID` — implemented inline so the SDK doesn't take a hard runtime dependency on ext-apps.

### Changed

- `ITransportContext` and `IToolHandlerParams` gained the optional `clientCapabilities?: IClientCapabilities` field. Backward compatible — existing handlers ignoring the field continue to work.

## [0.4.109] - 2026-05-17

### Added

- New **Tool Tester** tab in the Agent Tester UI (`/agent-tester`) — invokes MCP tools directly without involving an LLM. Shares the connection panel (URL, transport, headers, status, tool count) with the Chat tab. Layout: tool dropdown + JSON request editor on the left, response on the right; an optional parameter-schema panel can be toggled to give a 3-column view (schema | request | response).
- Tool Tester request editor: `Generate JSON` button builds a skeleton from the selected tool's `inputSchema` (honours `required`, `default`, `enum`, `examples`); `Validate` button runs a client-side JSON-Schema validator (`type` incl. `integer⊂number`, `required`, `properties`, `additionalProperties`, `enum`, `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`, `minLength`/`maxLength`/`pattern`, `items`/`minItems`/`maxItems`). Request JSON is persisted in `localStorage` under `mcpAgentTesterToolJson_<toolName>` with a 600 ms debounce and restored when the tool is reselected.
- Tool Tester response viewer: toggle button extracts the first `content[].text` entry into a light-blue panel; if the text parses as JSON, it is rendered as pretty-printed JSON (otherwise plain text). Status line shows `Success in Nms` / `Error in Nms`.
- New HTTP endpoint `POST /agent-tester/api/mcp/call-tool` — body `{ serverName, toolName, parameters }`, returns `{ success, result, durationMs }`. Reuses the cached MCP client via `TesterMcpClientService.callToolWithConfig`; auto-reissues the agent-tester JWT on 401 when targeting the SDK's own server.
- New static asset — browser port of `prettyPrintJson` from `af-tools-ts` (extended variant: deserializes JSON escape sequences, wraps strings longer than `maxTextLength` in a scrollable `.json-long-text-content` container). Exposed as `window.prettyPrintJson`; used to syntax-highlight both the parameter schema and the response.

### Changed

- Agent Tester UI: tab navigation bar added at the top of the main content area (`Chat` / `Tool Tester`). The existing chat workflow is unchanged and lives under the `Chat` tab. Connecting to an MCP server now also populates the Tool Tester's tool dropdown automatically.

## [0.4.108] - 2026-05-17

### Added

- New public export `applyLoggerSettings(overrides: Partial<ILoggerSettings>)` from `fa-mcp-sdk` — applies a shallow merge of user-supplied logger settings on top of the built-in defaults. Specified fields override defaults; the cached logger and all sub-loggers are reset so subsequent log calls pick up the new settings. No-op in STDIO mode.
- `McpServerData.loggerSettings?: Partial<ILoggerSettings>` — pass overrides via `initMcpServer({ ..., loggerSettings: { level: 'silly', maskValuesRegEx: [] } })`. Applied automatically at the top of `initMcpServer` before any further logging.
- New config key `logger.disableMasking: boolean` (default `false`) — when `true`, disables the built-in secret/email/URL masking by setting `maskValuesRegEx = []`. Override via env `LOGGER_NO_MASK_VALUES=true`.
- `appConfig.sdkVersion: string` — version of the `fa-mcp-sdk` package itself (resolved from the SDK's own `package.json`, not the consumer project's). Exposed alongside `appConfig.version`.
- Agent Tester UI: info button (ⓘ) next to the `MCP Agent Tester` header. Click toggles a tooltip showing the SDK version (`fa-mcp-sdk v<X.Y.Z>`); clicking outside or on the icon again hides it. The version is served by `GET /agent-tester/api/config` as `sdkVersion`.
- New Claude Code settings template (`defaultMode: bypassPermissions` + notification env defaults) shipped at the SDK root and in the CLI template. Copy to a local settings file as a starting point; the local settings file is preserved by `/upgrade-sdk`.

### Changed

- The logger was rewritten with lazy proxy-based initialization. The exported `logger` is now a `Proxy` that resolves the real `af-logger-ts` logger on first access; `logger.getSubLogger(opts)` returns a per-key cached sub-logger proxy. Calling `applyLoggerSettings()` clears the cache so existing top-level `const logger = lgr.getSubLogger(...)` bindings transparently pick up the new settings on next use — no need to re-import. `fileLogger` is also proxied and remains compatible with the existing `fileLogger?.asyncFinish` / `fileLogger?.logDir` access patterns.
- Agent Tester UI: `#systemPrompt` (Agent Prompt) textarea grown from `rows="3"` to `rows="8"` (~170 px initial height). `#messageInput` (chat input) grown from `rows="1"` / `min-height: 56 px` / `max-height: 120 px` to `rows="2"` / `min-height: 112 px` / `max-height: 240 px`; the auto-resize ceiling updated to match.
- The SDK update helper: the `preserve` list for `.claude/` now includes the local settings file so a local-only override is never overwritten by `/upgrade-sdk`. The `individualScripts` list refreshed by `/upgrade-sdk` expanded to also pull the full helper script set (lint/format hook, ext-apps clone helper, temp-copy helper, port killer, pre-commit hook, NUL-stripper, and the update helper itself) — generated projects now receive the full helper script set on upgrade.

## [0.4.102] - 2026-05-16

### Added

- New helper and npm scripts `agents:link` / `agents:link:status` / `agents:link:remove` create a cross-platform symlink `.agents/skills -> .claude/skills` (NTFS junction on Windows, relative symlink elsewhere) so OpenAI Codex can reuse Claude Code skills from one canonical storage. Setup is idempotent and supports `--dry-run` and `--force` (replace a mismatched link). Only skills are linked because Codex agents, MCP config, hooks, and settings use formats that are not compatible with `.claude/`. The helper and the three `agents:*` npm scripts are copied verbatim into projects generated by `fa-mcp`, so any downstream MCP server gets the same workflow out of the box.

## [0.4.101] - 2026-05-16

### Added

- New shared helper that clones or refreshes `modelcontextprotocol/ext-apps` into a persistent `./mcp-ext-apps/` checkout at the project root (gitignored, never deleted by the script). On first run it clones the default branch; on subsequent runs it pulls main and re-fetches tags. `--tag latest` resolves the latest published `@modelcontextprotocol/ext-apps` version via `npm view` and checks out `v<version>`; `--tag v1.7.2` checks out a specific tag. `--json` emits machine-readable metadata (`path`, `ref`, `refType`, `commit`, `latestNpmVersion`). `--list-examples` adds an `examples[]` array with `{ name, relativePath, description, readmeHeading, readmeOpening }` for each example directory, pre-collected from project manifests and READMEs so downstream skills can classify examples in one JSON walk instead of dozens of sequential reads. The helper is copied verbatim into projects scaffolded by `fa-mcp`, so the relative path is identical in the SDK repo and in any generated MCP server.
- JetBrains IDE project codestyle now tracked in version control so WebStorm / IDEA users get the project-specific formatting rules on clone.

### Changed

- `McpServerData.toolHandler` signature tightened from `<T = TToolHandlerResponse>(params) => Promise<T>` to `<T = unknown>(params) => Promise<TToolHandlerResponse<T>>`. Previously `T` sat in return position, letting bidirectional inference silently coerce `T` into whatever shape the caller expected — a latent typing hole. The return shape is now fixed as `IToolHandlerTextResponse | IToolHandlerStructuredResponse<T>`, and `T` narrows only `structuredContent`.
- MCP Apps skills (`/update-mcp-apps-spec` in the SDK; `/mcp-app-create` and `/mcp-app-add-to-server` in the CLI template) now delegate cloning to the shared clone helper instead of running an inline `git clone --depth 1 --branch v<ver>` into a throwaway `mktemp -d`. The reference checkout is reused across skill runs and across sibling skills, so an `/update-mcp-apps-spec` run leaves the same `./mcp-ext-apps/` available for `/mcp-app-create` without re-cloning.
- The `/update-mcp-apps-spec` skill's reference clone is now persistent: `Step 5: Cleanup` (which deleted the temp dir) was replaced with `Step 5: Keep the Clone`.
- Version-control ignore rules: `.idea/` is no longer ignored (IDE config files are now tracked — see Added above), and `/mcp-ext-apps/` is now ignored (helper's persistent checkout must never be committed). The CLI template mirrors the `/mcp-ext-apps/` addition.

### Fixed

- TypeScript compilation errors at the MCP SDK boundary (the `setRequestHandler(CallToolRequestSchema, ...)` handlers) — return value is now cast through `as any`, mirroring the existing cast already used for `ReadResourceRequestSchema`. The SDK expects `Result | ServerResult`, and TS does not resolve the correct branch of the target union when both source and target are unions.

## [0.4.98] - 2026-05-15

### Added

- Public types `TToolHandlerResponse`, `IToolHandlerTextResponse`, `IToolHandlerStructuredResponse` exported from `fa-mcp-sdk`; describe the discriminated union a tool handler must return.

### Changed

- `McpServerData.toolHandler` is now generic: `<T = TToolHandlerResponse>(params: IToolHandlerParams) => Promise<T>` — replaces the previous `Promise<any>` signature.
- `formatToolResult<T>()` now returns `TToolHandlerResponse<T>`; `asTextContent()` returns `IToolHandlerTextResponse`; `asJson<T>()` returns `IToolHandlerStructuredResponse<T>`.
- The template tool handler example now types the handler return as `TToolHandlerResponse`.

### Fixed

- STDIO and SSE transports now forward the tool handler's full result to the MCP client; previously they hard-coded `{ content: result.content }`, dropping `structuredContent` when `appConfig.mcp.tools.answerAs === 'structuredContent'`.

## [0.4.97] - 2026-05-13

### Added

- Token Generator UI (`/admin`) — new "Allow admin panel access" checkbox stamps the `allow: 'gen-token'` claim into issued JWTs (checked by default); the auth-token textarea was enlarged from 3 to 9 rows to fit full JWT strings.

### Changed

- Admin-panel 401 responses now surface the most relevant per-type failure reason — JWT-specific error when the supplied credential looks like a JWT, Basic-specific error for the basic scheme, permanent-token error otherwise — instead of a single generic "no matching auth type" message. Each configured auth type is tried in order and its error is collected, then the most appropriate one is returned to the client (and logged).

## [0.4.96] - 2026-05-13

### Changed

- Rename cli-template skill `upgrade-guide` → `upgrade-sdk`; runs the upgrade end-to-end (plan → confirm → apply → verify → report) rather than generating a plan-only document.

### Added

- The SDK update helper now also syncs the JWT generation script from the SDK into downstream projects alongside the framework docs and `.claude/`.

## [0.4.95] - 2026-05-13

### Changed

- JWT issuance migrated to standard signed JWT (HS256) — issued tokens are now 3-segment `header.payload.signature` strings; `webServer.auth.jwtToken.encryptKey` now acts as the HS256 signing secret (min 8 chars).
- Pre-migration legacy tokens (`<expire_ms>.<hex>` AES-256-CTR) are still accepted by the verifier for backward compatibility.
- `generateToken` now stamps standard claims: `sub` (user), `aud` (service), `exp` (expiration), and auto-generated `jti`.
- Admin panel 401 message replaces the JWT-specific hint with a generic "looks like a JWT" diagnostic, since permanent tokens may also contain dots.

### Added

- `webServer.auth.jwtToken.issuer` (env `WS_JWT_ISSUER`) — when non-empty, the generator stamps the `iss` claim and the verifier requires it.
- Revocation by JWT `jti`: entries without dots in `webServer.auth.revoked.jwtTokens` are matched against the token's `jti` claim (full-token strings still match exactly).
- Multi-audience (`aud` array) JWT claim handling in verification and normalization.
- `ITokenPayload` exposes optional `jti`, `iss`, `service`, `iat`, and `ip` fields for downstream handlers.
- `jsonwebtoken` runtime dependency for industry-standard JWT signing and verification.

### Fixed

- JWT verification now rejects tokens missing the `exp` claim instead of accepting them as non-expiring.



### Changed

- Admin panel 401 message now reports the disallowed credential type (e.g. JWT into a `permanentServerTokens`-only panel) instead of generic.

## [0.4.87] - 2026-05-11

### Added

- `agentTester.tokenTTLSec` (env `AGENT_TESTER_TOKEN_TTL_SEC`, default 1800s) — TTL of Agent Tester auto-issued JWTs.
- Agent Tester JWT refresh with self-authentication retries for headless clients via `/agent-tester/api/auth-token`.
- Outbound webhook support in tools via the internal tools manager.
- Resolve and propagate preferred client language for MCP responses.
- New cli-template skills `mcp-app-create` and `mcp-app-add-to-server` to scaffold and wire up MCP apps.

### Changed

- Replace the CLI-template doc-update helper with an SDK-update helper; preserves pinned folders during SDK template updates.
- Rename cli-template `deploy-mcp` skill to `create-mcp-wizard`.
- Switch CLI scaffolder/template tooling from ESLint to Oxlint + Oxfmt.
- Remove `NODE_ENV` handling from the `fa-mcp` CLI scaffolder and the example CLI config.

## [0.4.61] - 2026-04-21

### Breaking

- Rename `webServer.adminAuth.{enabled,type}` → `adminPanel.{enabled,authType}`; env `WS_ADMIN_AUTH_*` → `ADMIN_PANEL_*`.
- Move `mcp.toolAnswerAs` under `mcp.tools.answerAs`; env `MCP_TOOL_ANSWER_AS` → `MCP_TOOLS_ANSWER_AS`.
- Rename `agentTester.openAi.baseUrl` → `baseURL`; standardize `baseURL` casing across all modules.
- Rename Agent Tester `systemPrompt` → `agentPrompt` for prompt control.

### Added

- Admin panel multi-auth: `adminPanel.authType` accepts an array (e.g. `['jwtToken','basic']`) or `'none'` for local use.
- JWT generation CLI and opt-in HTTP endpoint `POST /gen-jwt` via `webServer.genJwtApiEnable`.
- Optional JWT IP restriction: `webServer.auth.jwtToken.isCheckIP` (env `WS_JWT_CHECK_IP`).
- Revocation lists `webServer.auth.revoked.{jwtTokens,users}` reject matching credentials in MCP, admin and Agent Tester.
- Agent Tester session auth: `agentTester.useAuth` (full multi-auth) and `agentTester.sessionTtlMs` (default 8h).
- Agent Tester structured logging via `agentTester.logJson` for tool/LLM/response events to stdout.
- `agentTester.openAi.exposeToClient` (default `false`) sends LLM defaults to the browser on trusted deployments.
- Export `checkLlm` for connectivity checks.
- `agentTester.showFooterLink` to hide the Agent Tester link in the home footer without disabling the tester.
- `homePage.helpLink` and `homePage.maintainer` config for footer links on the service home page.
- `mcp.tools.hideAnnotations` flag (env `MCP_TOOLS_HIDE_ANNOTATIONS`) to suppress tool annotations in responses.
- Export `AdminAuthType` and `AdminAuthTypeInput` from the package barrel.
- Lazy, memoized evaluation for authentication configuration and custom validators.
- Outbound webhooks support in tools.

### Changed

- Switch CLI scaffolder and templates from npm to yarn across scripts.
- Refactor Agent Tester LLM-settings modal UX; add GPT-5.4 and GPT-5.3-Codex to model selection.
- Heavily annotate the default config with inline operator documentation.

### Security

- Admin-panel JWTs must now carry the `allow: 'gen-token'` claim; Agent Tester auth fallback prioritizes JWT.

## [0.3.2] - 2026-05-11

### Added

- Agent Tester: built-in `/agent-tester` chat UI with `createAgentTesterRouter` export and an OpenAI-backed agent for live MCP tool testing; configured via `appConfig.agentTester.{enabled, useAuth, openAi.apiKey, openAi.baseUrl, httpHeaders, logJson}`.
- Env vars `AGENT_TESTER_ENABLED`, `AGENT_TESTER_USE_AUTH`, `AGENT_TESTER_OPENAI_API_KEY`, `AGENT_TESTER_OPENAI_BASE_URL` to drive Agent Tester configuration.
- Headless API endpoints for automated MCP tool testing with trace data and JSON-format log output.
- `McpServerData.customStartupInfo: [string, string][]` to append custom diagnostic rows to the server startup info block.
- Export `asJson` and `asTextContent` helpers from `formatToolResult`; re-export the MCP SDK `Tool` type from the package barrel.

### Changed

- Bump runtime dependencies.
- CLI `fa-mcp` scaffolder rewrites the generated `package.json` via regex and conditionally removes the `postinstall` script based on the template config.

## [0.2.265] - 2026-05-11

### Breaking

- Rename `IRequiredHttpHeader` to `IUsedHttpHeader`; rename `McpServerData.requiredHttpHeaders` to `usedHttpHeaders`.
- Replace per-API `IGet*Args` interfaces with the universal `ITransportContext` (`{ transport, headers, payload }`).
- Change `McpServerData.toolHandler` to a single `IToolHandlerParams` argument that now carries `transport`.
- Remove `httpComponents.endpointsOn404` from `McpServerData`.

### Added

- Export `ITransportContext`, `IToolHandlerParams`, and `TTransportType` for transport-aware handlers.
- Allow `McpServerData.tools`, `customPrompts`, and `customResources` to be async functions of `ITransportContext`.
- Propagate `transport` (`stdio` | `sse` | `http`) into tool, prompt, and resource handlers.
- Export `getProjectData`, `getSafeAppConfig`, `getTools` from the package barrel; re-export `Logger` from `af-logger-ts`.
- `fa-mcp --version` CLI flag prints the installed SDK version.
- Read service identity from env: `SERVICE_NAME` → `appConfig.name`, `PRODUCT_NAME` → `appConfig.productName`.

### Changed

- Bump `@modelcontextprotocol/sdk` to `1.25.2`.
- Reduce admin-router log noise by removing redundant request/auth log lines.
