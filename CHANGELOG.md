# Changelog

All notable changes to `fa-mcp-sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.100] - 2026-05-16

### Added

- New maintainer skill `/update-mcp-apps-spec` (`.claude/skills/update-mcp-apps-spec/`) — regenerates `cli-template/FA-MCP-SDK-DOC/10-mcp-apps.md` from the upstream `modelcontextprotocol/ext-apps` repository pinned to the latest released tag of `@modelcontextprotocol/ext-apps`. Walks the normative spec (`apps.mdx`), SDK source (`src/app.ts`, `src/server/index.ts`, `src/spec.types.ts`, React hooks, transport, styles), supporting docs, and the full `examples/` tree, then produces a self-contained digest with verbatim lifecycle mermaid diagrams, the protocol contract (MUST/SHOULD/MAY), the SDK API surface, host context schema, recipes, common pitfalls, an examples-by-use-case map, and a reference index. Every external link is pinned to the same upstream tag as the digest header, so the LLM consuming the digest can fetch the exact corresponding source. The skill also refreshes matching rows in `00-FA-MCP-SDK-index.md` and `cli-template/CLAUDE.md` automatically and explicitly does not modify `src/core/**` or scaffold MCP App tools.
- `cli-template/FA-MCP-SDK-DOC/10-mcp-apps.md` — first generation of the MCP Apps digest, pinned to `@modelcontextprotocol/ext-apps` v1.7.2 (spec 2026-01-26, commit `9a37ad7`). 13 sections covering: protocol contract (`ui://` URIs, `_meta.ui` location matrix, capability negotiation, CSP rules, all Host↔View JSON-RPC messages including the `ui/notifications/sandbox-*` proxy reservation), the four canonical lifecycle diagrams reproduced verbatim from the spec, the full `App` class API including every `on*` event handler and host-bound method, server helpers (`registerAppTool`, `registerAppResource`, `getUiCapability`), the React hook surface, every `McpUiHostContext` field and the standardized CSS-variable list, 13 worked recipes, an authorization section (per-server, per-tool, UI-initiated step-up), a testing section centred on `basic-host`, a common-pitfalls list, an examples-by-use-case classification (smallest skeleton, mixed tool patterns, per-framework starters, 13 domain references with per-server "what it shows" descriptions), and a reference index with 22 tag-pinned GitHub URLs.

### Changed

- `McpServerData.toolHandler` signature tightened from `<T = TToolHandlerResponse>(params) => Promise<T>` to `<T = unknown>(params) => Promise<TToolHandlerResponse<T>>`. Previously `T` sat in return position, letting bidirectional inference silently coerce `T` into whatever shape the caller expected — a latent typing hole. The return shape is now fixed as `IToolHandlerTextResponse | IToolHandlerStructuredResponse<T>`, and `T` narrows only `structuredContent`.

### Fixed

- TypeScript compilation errors at the MCP SDK boundary in `src/core/mcp/create-mcp-server.ts:47` and `src/core/web/server-http.ts:343` (the `setRequestHandler(CallToolRequestSchema, ...)` handlers) — return value is now cast through `as any`, mirroring the existing cast already used for `ReadResourceRequestSchema`. The SDK expects `Result | ServerResult`, and TS does not resolve the correct branch of the target union when both source and target are unions.

### Docs

- `cli-template/FA-MCP-SDK-DOC/01-getting-started.md` — updated the `McpServerData.toolHandler` signature in the Core Types section to match the new declaration.
- `cli-template/FA-MCP-SDK-DOC/00-FA-MCP-SDK-index.md` — added the entry pointing at `10-mcp-apps.md` (MCP Apps digest, pinned to `@modelcontextprotocol/ext-apps` v1.7.2).
- `cli-template/CLAUDE.md` — added rows for `09-database.md` (previously missing from the Framework Documentation table) and `10-mcp-apps.md`.
- `CLAUDE.md` (root SDK) — new section "MCP Apps Spec Digest (Skill /update-mcp-apps-spec)" documenting the maintainer skill: triggers, what it touches (digest + two index files only — never `src/core/**`), and what it produces.

## [0.4.99] - 2026-05-15

No functional changes (technical version bump after the 0.4.98 release).

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
