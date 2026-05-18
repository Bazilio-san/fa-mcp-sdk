# Changelog

All notable changes to `fa-mcp-sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.112] - 2026-05-18

### Added

- Add `scripts/+x.js` to restore executable bits on bundled helper scripts.
- Add `cli-template/preferred-language.txt` so generated projects default project guidance to English.

### Changed

- Rename the Codex skill-link helper to `scripts/claude-2-agents-symlink.js`.
- Point `agents:link*` scripts and `scripts/update-sdk.js` at the renamed helper in generated projects.

## [0.4.110] - 2026-05-17

### Added

- **MCP Apps support — client capability propagation** (SEP-1865). `IToolHandlerParams.clientCapabilities` and `ITransportContext.clientCapabilities` are now populated on every call so handlers can branch UI-augmented vs. text-only output without giving up the upstream MCP Apps text-fallback contract.
  - STDIO: `Server.getClientCapabilities()` is read inside every `tools/list`, `tools/call`, `prompts/list`, `prompts/get`, `resources/list`, `resources/read` handler in `createMcpServer()`.
  - SSE: `sseServer.getClientCapabilities()` is read on every dispatched call (lazy via the new `sseCtx()` closure) — the per-connection MCP server already holds capabilities after handshake.
  - Streamable HTTP: capabilities reported on `initialize` are cached in an in-memory `Map` keyed by the `Mcp-Session-Id` header (soft FIFO cap of 4096 sessions, oldest evicted first). Subsequent stateless POSTs from the same session receive the cached value; sessions without the header get `undefined` (handler MUST fall back to text-only).
- New type `IClientCapabilities = ClientCapabilities & { extensions?: Record<string, unknown> }` re-exported from `fa-mcp-sdk` — covers the open-ended `extensions` envelope MCP Apps and future SEPs publish alongside the standard fields.
- New helpers `getUiCapability(clientCapabilities)`, `hostSupportsMcpApps(clientCapabilities)`, `MCP_APPS_EXTENSION_ID`, `MCP_APPS_RESOURCE_MIME_TYPE`, and type `IMcpUiClientCapabilities` exported from `fa-mcp-sdk` (`src/core/mcp/mcp-apps.ts`). Mirror of `@modelcontextprotocol/ext-apps/server`'s `getUiCapability` / `RESOURCE_MIME_TYPE` / `EXTENSION_ID` — implemented inline so the SDK doesn't take a hard runtime dependency on ext-apps.

### Changed

- `ITransportContext` and `IToolHandlerParams` gained the optional `clientCapabilities?: IClientCapabilities` field. Backward compatible — existing handlers ignoring the field continue to work.

## [0.4.109] - 2026-05-17

### Added

- New **Tool Tester** tab in the Agent Tester UI (`/agent-tester`) — invokes MCP tools directly without involving an LLM. Shares the connection panel (URL, transport, headers, status, tool count) with the Chat tab. Layout: tool dropdown + JSON request editor on the left, response on the right; an optional parameter-schema panel can be toggled to give a 3-column view (schema | request | response).
- Tool Tester request editor: `Generate JSON` button builds a skeleton from the selected tool's `inputSchema` (honours `required`, `default`, `enum`, `examples`); `Validate` button runs a client-side JSON-Schema validator (`type` incl. `integer⊂number`, `required`, `properties`, `additionalProperties`, `enum`, `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`, `minLength`/`maxLength`/`pattern`, `items`/`minItems`/`maxItems`). Request JSON is persisted in `localStorage` under `mcpAgentTesterToolJson_<toolName>` with a 600 ms debounce and restored when the tool is reselected.
- Tool Tester response viewer: toggle button extracts the first `content[].text` entry into a light-blue panel; if the text parses as JSON, it is rendered as pretty-printed JSON (otherwise plain text). Status line shows `Success in Nms` / `Error in Nms`.
- New HTTP endpoint `POST /agent-tester/api/mcp/call-tool` — body `{ serverName, toolName, parameters }`, returns `{ success, result, durationMs }`. Reuses the cached MCP client via `TesterMcpClientService.callToolWithConfig`; auto-reissues the agent-tester JWT on 401 when targeting the SDK's own server.
- New static asset `src/core/web/static/agent-tester/pretty-print-json.js` — browser port of `prettyPrintJson` from `af-tools-ts` (extended variant: deserializes JSON escape sequences, wraps strings longer than `maxTextLength` in a scrollable `.json-long-text-content` container). Exposed as `window.prettyPrintJson`; used to syntax-highlight both the parameter schema and the response.

### Changed

- Agent Tester UI: tab navigation bar added at the top of the main content area (`Chat` / `Tool Tester`). The existing chat workflow is unchanged and lives under the `Chat` tab. Connecting to an MCP server now also populates the Tool Tester's tool dropdown automatically.

## [0.4.108] - 2026-05-17

### Added

- New public export `applyLoggerSettings(overrides: Partial<ILoggerSettings>)` from `src/core/index.ts` — applies a shallow merge of user-supplied logger settings on top of the built-in defaults. Specified fields override defaults; the cached logger and all sub-loggers are reset so subsequent log calls pick up the new settings. No-op in STDIO mode.
- `McpServerData.loggerSettings?: Partial<ILoggerSettings>` — pass overrides from `start.ts` via `initMcpServer({ ..., loggerSettings: { level: 'silly', maskValuesRegEx: [] } })`. Applied automatically at the top of `initMcpServer` before any further logging.
- New config key `logger.noMaskValues: boolean` (default `false`) — when `true`, disables the built-in secret/email/URL masking by setting `maskValuesRegEx = []`. Override via env `LOGGER_NO_MASK_VALUES=true`. Mirrored in `config/default.yaml`, `_local.yaml`, `local.yaml`, `test.yaml`, and `custom-environment-variables.yaml`.
- `appConfig.sdkVersion: string` — version of the `fa-mcp-sdk` package itself (resolved from the SDK's own `package.json`, not the consumer project's). Exposed alongside `appConfig.version`.
- Agent Tester UI: info button (ⓘ) next to the `MCP Agent Tester` header. Click toggles a tooltip showing the SDK version (`fa-mcp-sdk v<X.Y.Z>`); clicking outside or on the icon again hides it. The version is served by `GET /agent-tester/api/config` as `sdkVersion`.
- New `.claude/settings.local-example.json` template (Claude Code `defaultMode: bypassPermissions` + notification env defaults) shipped at the SDK root and in `cli-template/.claude/`. Copy to `settings.local.json` as a starting point; `settings.local.json` is preserved by `/upgrade-sdk`.

### Changed

- `src/core/logger.ts` rewritten with lazy proxy-based initialization. The exported `logger` is now a `Proxy` that resolves the real `af-logger-ts` logger on first access; `logger.getSubLogger(opts)` returns a per-key cached sub-logger proxy. Calling `applyLoggerSettings()` clears the cache so existing top-level `const logger = lgr.getSubLogger(...)` bindings transparently pick up the new settings on next use — no need to re-import. `fileLogger` is also proxied and remains compatible with the existing `fileLogger?.asyncFinish` / `fileLogger?.logDir` access patterns.
- Agent Tester UI: `#systemPrompt` (Agent Prompt) textarea grown from `rows="3"` to `rows="8"` (~170 px initial height). `#messageInput` (chat input) grown from `rows="1"` / `min-height: 56 px` / `max-height: 120 px` to `rows="2"` / `min-height: 112 px` / `max-height: 240 px`; the auto-resize ceiling in `script.js` updated to match.
- `scripts/update-sdk.js`: `preserve` list for `.claude/` now includes `settings.local.json` so a local-only override is never overwritten by `/upgrade-sdk`. The `individualScripts` list refreshed by `/upgrade-sdk` expanded to also pull `cc-hook-oxlint-oxfmt-fix.cjs`, `clone-mcp-ext-apps.js`, `fcp.js`, `kill-port.js`, `pre-commit`, `remove-nul.js`, and `update-sdk.js` itself — generated projects now receive the full helper script set on upgrade.

## [0.4.102] - 2026-05-16

### Added

- New helper `scripts/claude-2-agents-symlink.js` and npm scripts `agents:link` / `agents:link:status` / `agents:link:remove` create a cross-platform symlink `.agents/skills -> .claude/skills` (NTFS junction on Windows, relative symlink elsewhere) so OpenAI Codex can reuse Claude Code skills from one canonical storage. Setup is idempotent and supports `--dry-run` and `--force` (replace a mismatched link). Only skills are linked because Codex agents (`.codex/agents/*.toml`), MCP config (`.codex/config.toml`), hooks, and settings use formats that are not compatible with `.claude/`. The script and the three `agents:*` npm scripts are copied verbatim into projects generated by `fa-mcp`, so any downstream MCP server gets the same workflow out of the box.
- New `AGENTS.md` files at the repo root and in `cli-template/` hold the full project guidance — this is the document Codex reads natively, and it contains the content that previously lived in `CLAUDE.md`.
- `README.md` and `cli-template/README.md` document the Codex-sharing workflow (the three `agents:link*` npm commands, what is linked vs. excluded, and the `CLAUDE.md` → `AGENTS.md` import setup).

### Changed

- `CLAUDE.md` (repo root and `cli-template/`) reduced to a single-line `@AGENTS.md` import so one guidance document now feeds both Claude Code and Codex without duplication. Downstream projects on 0.4.101 that customised `CLAUDE.md` should migrate the customisation into `AGENTS.md` after upgrading; `CLAUDE.md` itself stays as a thin import.

## [0.4.101] - 2026-05-16

### Added

- New maintainer skill `/update-mcp-apps-spec` (`.claude/skills/update-mcp-apps-spec/`) — regenerates `cli-template/FA-MCP-SDK-DOC/10-mcp-apps.md` from the upstream `modelcontextprotocol/ext-apps` repository pinned to the latest released tag of `@modelcontextprotocol/ext-apps`. Walks the normative spec (`apps.mdx`), SDK source (`src/app.ts`, `src/server/index.ts`, `src/spec.types.ts`, React hooks, transport, styles), supporting docs, and the full `examples/` tree, then produces a self-contained digest with verbatim lifecycle mermaid diagrams, the protocol contract (MUST/SHOULD/MAY), the SDK API surface, host context schema, recipes, common pitfalls, an examples-by-use-case map, and a reference index. Every external link is pinned to the same upstream tag as the digest header, so the LLM consuming the digest can fetch the exact corresponding source. The skill also refreshes matching rows in `00-FA-MCP-SDK-index.md` and `cli-template/CLAUDE.md` automatically and explicitly does not modify `src/core/**` or scaffold MCP App tools.
- `cli-template/FA-MCP-SDK-DOC/10-mcp-apps.md` — first generation of the MCP Apps digest, pinned to `@modelcontextprotocol/ext-apps` v1.7.2 (spec 2026-01-26, commit `9a37ad7`). 13 sections covering: protocol contract (`ui://` URIs, `_meta.ui` location matrix, capability negotiation, CSP rules, all Host↔View JSON-RPC messages including the `ui/notifications/sandbox-*` proxy reservation), the four canonical lifecycle diagrams reproduced verbatim from the spec, the full `App` class API including every `on*` event handler and host-bound method, server helpers (`registerAppTool`, `registerAppResource`, `getUiCapability`), the React hook surface, every `McpUiHostContext` field and the standardized CSS-variable list, 13 worked recipes, an authorization section (per-server, per-tool, UI-initiated step-up), a testing section centred on `basic-host`, a common-pitfalls list, an examples-by-use-case classification (smallest skeleton, mixed tool patterns, per-framework starters, 13 domain references with per-server "what it shows" descriptions), and a reference index with 22 tag-pinned GitHub URLs.
- `scripts/clone-mcp-ext-apps.js` — shared helper that clones or refreshes `modelcontextprotocol/ext-apps` into a persistent `./mcp-ext-apps/` checkout at the project root (gitignored, never deleted by the script). On first run it clones the default branch; on subsequent runs it pulls main and re-fetches tags. `--tag latest` resolves the latest published `@modelcontextprotocol/ext-apps` version via `npm view` and checks out `v<version>`; `--tag v1.7.2` checks out a specific tag. `--json` emits machine-readable metadata (`path`, `ref`, `refType`, `commit`, `latestNpmVersion`). `--list-examples` adds an `examples[]` array with `{ name, relativePath, description, readmeHeading, readmeOpening }` for each `examples/*` directory, pre-collected from `package.json` and `README.md` so downstream skills can classify examples in one JSON walk instead of dozens of sequential reads. The script is copied verbatim into projects scaffolded by `fa-mcp`, so the relative path is identical in the SDK repo and in any generated MCP server.
- JetBrains IDE project codestyle now tracked in version control (`.idea/codeStyles/Project.xml`, `.idea/codeStyles/codeStyleConfig.xml`, `.idea/inspectionProfiles/Project_Default.xml`, `.idea/misc.xml`, `.idea/modules.xml`, `.idea/vcs.xml`, `.idea/fa-mcp-sdk.iml`, `.idea/.gitignore`) so WebStorm / IDEA users get the project-specific formatting rules on clone.

### Changed

- `McpServerData.toolHandler` signature tightened from `<T = TToolHandlerResponse>(params) => Promise<T>` to `<T = unknown>(params) => Promise<TToolHandlerResponse<T>>`. Previously `T` sat in return position, letting bidirectional inference silently coerce `T` into whatever shape the caller expected — a latent typing hole. The return shape is now fixed as `IToolHandlerTextResponse | IToolHandlerStructuredResponse<T>`, and `T` narrows only `structuredContent`.
- MCP Apps skills (`/update-mcp-apps-spec` in the SDK; `/mcp-app-create` and `/mcp-app-add-to-server` in `cli-template/`) now delegate cloning to `scripts/clone-mcp-ext-apps.js` instead of running an inline `git clone --depth 1 --branch v<ver>` into a throwaway `mktemp -d`. The reference checkout is reused across skill runs and across sibling skills, so an `/update-mcp-apps-spec` run leaves the same `./mcp-ext-apps/` available for `/mcp-app-create` without re-cloning.
- `/update-mcp-apps-spec` skill: `Step 5: Cleanup` (which deleted the temp dir) replaced with `Step 5: Keep the Clone` — the folder is intentionally persistent now. Sections 12.1–12.4 of the digest are built from the helper's `examples[]` JSON (one walk) instead of `ls examples/` + per-directory `package.json` / `README.md` reads. Cross-checks #4 and #8 also diff against the JSON array. The tool-composition row in section 12.2 still requires reading the example's `server.ts` directly, since `package.json` / `README.md` rarely list tool names verbatim.
- `.gitignore`: `.idea/` removed (IDE config files are now tracked — see Added above), `/mcp-ext-apps/` added (helper's persistent checkout must never be committed). `cli-template/gitignore` mirrors the `/mcp-ext-apps/` addition.

### Fixed

- TypeScript compilation errors at the MCP SDK boundary in `src/core/mcp/create-mcp-server.ts:47` and `src/core/web/server-http.ts:343` (the `setRequestHandler(CallToolRequestSchema, ...)` handlers) — return value is now cast through `as any`, mirroring the existing cast already used for `ReadResourceRequestSchema`. The SDK expects `Result | ServerResult`, and TS does not resolve the correct branch of the target union when both source and target are unions.

### Docs

- `cli-template/FA-MCP-SDK-DOC/01-getting-started.md` — updated the `McpServerData.toolHandler` signature in the Core Types section to match the new declaration.
- `cli-template/FA-MCP-SDK-DOC/00-FA-MCP-SDK-index.md` — added the entry pointing at `10-mcp-apps.md` (MCP Apps digest, pinned to `@modelcontextprotocol/ext-apps` v1.7.2).
- `cli-template/CLAUDE.md` — added rows for `09-database.md` (previously missing from the Framework Documentation table) and `10-mcp-apps.md`; new section "MCP Apps Reference Clone (`scripts/clone-mcp-ext-apps.js`)" documenting the helper available in generated projects and listing all CLI flags.
- `CLAUDE.md` (root SDK) — new section "MCP Apps Spec Digest (Skill /update-mcp-apps-spec)" documenting the maintainer skill: triggers, what it touches (digest + two index files only — never `src/core/**`), and what it produces. Adjacent new section "MCP Apps Reference Clone (`scripts/clone-mcp-ext-apps.js`)" introduces the shared helper used by every MCP Apps skill and shows all CLI flags; the spec-digest description now references the helper invocation explicitly (`scripts/clone-mcp-ext-apps.js --tag latest --json --list-examples`) instead of vague "clones the latest released tag".

## [0.4.98] - 2026-05-15

### Added

- Public types `TToolHandlerResponse`, `IToolHandlerTextResponse`, `IToolHandlerStructuredResponse` exported from `fa-mcp-sdk`; describe the discriminated union a tool handler must return.

### Changed

- `McpServerData.toolHandler` is now generic: `<T = TToolHandlerResponse>(params: IToolHandlerParams) => Promise<T>` — replaces the previous `Promise<any>` signature.
- `formatToolResult<T>()` now returns `TToolHandlerResponse<T>`; `asTextContent()` returns `IToolHandlerTextResponse`; `asJson<T>()` returns `IToolHandlerStructuredResponse<T>`.
- Template `handle-tool-call.ts` example now types the handler return as `TToolHandlerResponse`.

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

- `scripts/update-sdk.js` now also syncs `scripts/generate-jwt.js` from the SDK into downstream projects alongside `FA-MCP-SDK-DOC/` and `.claude/`.

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

- Replace cli-template `update-doc.js` with `update-sdk.js`; preserves pinned folders during SDK template updates.
- Rename cli-template `deploy-mcp` skill to `create-mcp-wizard`.
- Switch CLI scaffolder/template tooling from ESLint to Oxlint + Oxfmt (`.oxlintrc.json`, `.oxfmtrc.json`).
- Remove `NODE_ENV` handling from the `fa-mcp` CLI scaffolder and `cli-config.example.yaml`.

## [0.4.61] - 2026-04-21

### Breaking

- Rename `webServer.adminAuth.{enabled,type}` → `adminPanel.{enabled,authType}`; env `WS_ADMIN_AUTH_*` → `ADMIN_PANEL_*`.
- Move `mcp.toolAnswerAs` under `mcp.tools.answerAs`; env `MCP_TOOL_ANSWER_AS` → `MCP_TOOLS_ANSWER_AS`.
- Rename `agentTester.openAi.baseUrl` → `baseURL`; standardize `baseURL` casing across all modules.
- Rename Agent Tester `systemPrompt` → `agentPrompt` for prompt control.

### Added

- Admin panel multi-auth: `adminPanel.authType` accepts an array (e.g. `['jwtToken','basic']`) or `'none'` for local use.
- JWT generation CLI `scripts/generate-jwt.js` and opt-in HTTP endpoint `POST /gen-jwt` via `webServer.genJwtApiEnable`.
- Optional JWT IP restriction: `webServer.auth.jwtToken.isCheckIP` (env `WS_JWT_CHECK_IP`); new `src/core/auth/ip-check.ts`.
- Revocation lists `webServer.auth.revoked.{jwtTokens,users}` reject matching credentials in MCP, admin and Agent Tester.
- Agent Tester session auth: `agentTester.useAuth` (full multi-auth) and `agentTester.sessionTtlMs` (default 8h).
- Agent Tester structured logging via `agentTester.logJson` for tool/LLM/response events to stdout.
- `agentTester.openAi.exposeToClient` (default `false`) sends LLM defaults to the browser on trusted deployments.
- Export `checkLlm` from `agent-tester/check-llm.js` for connectivity checks.
- `agentTester.showFooterLink` to hide the Agent Tester link in the home footer without disabling the tester.
- `homePage.helpLink` and `homePage.maintainer` config for footer links on the service home page.
- `mcp.tools.hideAnnotations` flag (env `MCP_TOOLS_HIDE_ANNOTATIONS`) to suppress tool annotations in responses.
- Export `AdminAuthType` and `AdminAuthTypeInput` from the package barrel.
- Lazy, memoized evaluation for authentication configuration and custom validators.
- Outbound webhooks support in tools.
- Satellite-based README assembly via `src/core/mcp/readme-assembler.ts`.

### Changed

- Switch CLI scaffolder and templates from npm to yarn across scripts and documentation.
- Refactor Agent Tester LLM-settings modal UX; add GPT-5.4 and GPT-5.3-Codex to model selection.
- Heavily annotate `config/default.yaml` with inline operator documentation.

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
