# Changelog

All notable changes to `fa-mcp-sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
