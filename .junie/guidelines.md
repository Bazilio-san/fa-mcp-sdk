### FA MCP SDK — Project‑specific Development Guidelines

#### 1) Project purpose
- fa-mcp-sdk provides core infrastructure and a ready-to-run template for building Model Context Protocol (MCP) servers in TypeScript/Node.js.
- It abstracts transport, HTTP API surface, prompts/resources tooling, rate limiting, config bootstrapping, logging, and optional service discovery (Consul), so you focus on domain tools, prompts, and resources.

Key outcomes:
- Start an HTTP or stdio MCP server with minimal code.
- Define MCP tools, prompts, and resources with strong typing and consistent routing.
- Ship a small, testable template server demonstrating best practices.

References:
- Root package metadata and scripts: `package.json`
- Core library exports: `src\core\index.ts` (compiled to `dist\core\index.js`)
- Template server wiring: `src\template\start.ts` (compiled to `dist\template\start.js`)

#### 2) Architecture (high level)
Runtime layers:
- Configuration/bootstrap
  - `src\core\bootstrap\init-config.ts` builds a typed `appConfig` from `config` (node-config package) and `package.json`.
  - `config\default.yaml` contains the primary config (web server, MCP transport, rate limit, optional DB, Consul, Swagger, colors, auth). Environment files may override by NODE_ENV.

- HTTP server + MCP router
  - `src\core\web\server-http.ts` creates the Express app, security headers (helmet), CORS, rate limiter, health/about endpoints, Swagger (if wired), and the JSON-RPC endpoint handling MCP methods.
  - Supported MCP routes in HTTP mode (JSON-RPC over POST):
    - `initialize`, `ping`,
    - `tools/list`, `tools/call`,
    - `prompts/list`, `prompts/get`,
    - `resources/list`, `resources/read`.
  - SSE transport support for client responses: the test client `McpSseClient` keeps an SSE channel for responses and posts requests via `/rpc`.

- MCP server core
  - `src\core\mcp\create-mcp-server.ts` assembles server capabilities and metadata from `appConfig`.
  - `src\core\mcp\prompts.ts` and `src\core\mcp\resources.ts` expose default wiring for prompts/resources; the template overrides/extends these via `src\template`.
  - `src\core\init-mcp-server.ts` orchestrates bootstrap, DB checks (optional), Consul registration (optional), and starts the selected transport (`appConfig.mcp.transportType`).

- Template server (reference implementation)
  - Entry: `src\template\start.ts`. Assembles:
    - Tools: `src\template\tools\tools.ts` + handler `src\template\tools\handle-tool-call.ts`
    - Prompts: `src\template\prompts\agent-brief.ts`, `agent-prompt.ts`, `custom-prompts.ts`
    - Resources: `src\template\custom-resources.ts`
    - HTTP components: API router `src\template\api\router.ts`, Swagger setup `src\template\api\swagger.ts`
    - Assets (favicon, maintainer HTML)

- Utilities and cross-cutting concerns
  - Logging: `src\core\logger.ts` (levels set by config; file logger can be enabled).
  - Errors: `src\core\errors\errors.ts`, `BaseMcpError`, `ValidationError`, helpers to return JSON-RPC compliant error payloads.
  - Rate limiting helpers: `src\core\utils\rate-limit.ts` (used by `server-http.ts`).
  - Token/auth: `src\core\token\*` (optional server tokens, JWT-like payloads, CLI token generator `npm run token-gen`).
  - Optional DB: `src\core\db\pg-db.ts` with `pgvector` support if enabled; controlled by `config.db.postgres`.
  - Consul integration (optional): `src\core\consul\*` with service registration and access point updates.

Build outputs:
- Library runtime: `dist\core\**\*.js`
- Template runtime: `dist\template\**\*.js`

#### 3) Technology map and where to find things (ключевые элементы и размещение кода)
- Transport & server
  - HTTP server: `src\core\web\server-http.ts` (Express, Helmet, CORS, rate limiting, endpoints). Start log printed with product name and port.
  - SSE support: served by HTTP layer and consumed by `McpSseClient` (testing client).
  - STDIO mode: controlled via `appConfig.mcp.transportType === 'stdio'`. See `docs\CHECK_STDIO.md` for usage details.

- MCP interface
  - Types re-exported from: `src\core\_types_\types.ts` via `src\core\index.ts`.
  - Public API exports (to consume as a library): `src\core\index.ts` exposes:
    - `appConfig`, `initMcpServer`, `gracefulShutdown`
    - Testing clients: `McpHttpClient`, `McpSseClient`, `McpStdioClient`, `McpStreamableHttpClient`
    - Utilities: `formatToolResult`, `getJsonFromResult`, `checkPortAvailability`, `logger`, etc.

- Template customization points
  - Tools list definition: `src\template\tools\tools.ts`
    - Helper schemas: `getGenericInputSchema`, `getSearchInputSchema`
    - Default examples: `example_tool`, `example_search`
  - Tool execution logic: `src\template\tools\handle-tool-call.ts`
  - Prompts: `src\template\prompts\*`
  - Resources: `src\template\custom-resources.ts`
  - HTTP API integration and docs: `src\template\api\router.ts`, `src\template\api\swagger.ts`

- Config
  - Defaults: `config\default.yaml`
  - Derived at runtime: `src\core\bootstrap\init-config.ts` creates `appConfig` and exposes `getProjectData()`.
  - Package metadata merged into config (name, version, description, keywords) from `package.json`.

- Docs useful for transport/testing
  - `docs\CHECK_STDIO.md` – how to use stdio mode.
  - `src\tests\mcp\*.js` – runnable test scripts for HTTP and SSE transports.

#### 4) Build and configuration instructions
Prerequisites
- Node.js >= 18 (see `package.json.engines`). Yarn or npm available. On Windows PowerShell, use backslashes in paths.

Install deps
```
npm ci
```

Build (clean + compile TS → dist)
```
npm run cb
```

Run template server (HTTP by default)
```
npm start
# or explicitly
node dist/template/start.js
```

Ports and transport
- Default HTTP host/port: `0.0.0.0:9876` from `config\default.yaml` → `webServer.port`.
- Transport selection: `mcp.transportType` in config. Values: `http` (default) or `stdio`.

Configuration
- Main file: `config\default.yaml`. Override by environment (node-config rules), env vars, or additional config files.
- Key toggles:
  - `webServer.auth.enabled` – turn on token auth if needed (with `permanentServerTokens`, `tokenEncryptKey`).
  - `mcp.rateLimit` – guard MCP methods (`tools/call` has per-IP limiter in `server-http.ts`).
  - `db.postgres.dbs.main.host` – if empty string, DB usage is disabled. If provided, DB checked on startup.
  - `consul.service.noRegOnStart` – set to `false` to register in Consul automatically (requires consul agent config).
  - `swagger.servers` – list of servers shown in Swagger.

Swagger UI
- If wired by template (`src\template\api\swagger.ts`), Swagger UI is exposed at `/docs` and uses `appConfig` metadata.

#### 5) Tests and verification
Template transport tests are provided and were checked to pass against the current codebase.

How to run:
```
npm run cb           # build first
node dist/template/start.js &   # start server (HTTP)

# In another terminal
node src/tests/mcp/test-http.js  # HTTP client
node src/tests/mcp/test-sse.js   # SSE client
```

Observed results (local verification prior to writing this file):
- HTTP tests: 9/9 passed
- SSE tests: 9/9 passed

Notes:
- Tests auto-read `appConfig.webServer.port`; override base URL via env `TEST_MCP_SERVER_URL` if needed.
- The SSE client (`src\core\utils\testing\McpSseClient.ts`) holds a long-lived SSE stream and posts JSON-RPC to `/rpc`.

#### 6) Development tips, code style, and debugging
Code style
- The repo uses ESLint (TypeScript) with scripts:
  - `npm run lint` and `npm run lint:fix`
- Type checking: `npm run typecheck`
- Follow existing naming and file layout conventions in `src\core` and `src\template`.

Adding tools
- Define the tool schema in `src\template\tools\tools.ts` (see `getGenericInputSchema`, `getSearchInputSchema`).
- Implement behavior in `src\template\tools\handle-tool-call.ts` and return values using `formatToolResult` from core if you need uniform formatting.
- The HTTP layer enforces rate limit per IP for `tools/call` (see `server-http.ts`). Make tool errors explicit (throw `BaseMcpError` or return structured error) for better client UX.

Adding prompts/resources
- Add prompt nodes in `src\template\prompts\*.ts` and include them in `customPrompts`.
- Add custom resources in `src\template\custom-resources.ts` and ensure each has a unique URI scheme.

Diagnostics
- Startup logs show product name and transport. About page at `/` includes config and runtime info; health at `/health`.
- JSON-RPC errors go through `createJsonRpcErrorResponse`; for domain errors, prefer throwing `BaseMcpError` or `ValidationError`.
- To inspect client/server exchange quickly, use the provided testing clients (`McpHttpClient`, `McpSseClient`).

Auth & tokens
- To enable token protection for HTTP endpoints set `webServer.auth.enabled: true` and configure `permanentServerTokens`. You can generate/testing tokens via:
```
npm run token-gen
```

DB & pgvector
- If `db.postgres.dbs.main.host` is configured, the server will attempt a connection on startup. `usedExtensions` supports `pgvector` enabling vector features (see `src\core\db\pg-db.ts`).

Consul integration
- Disabled by default (`noRegOnStart: true`). To enable, configure `consul.agent` and set `noRegOnStart: false`. UI link is derived via `getConsulUIAddress` in `src\template\start.ts`.

Stdio transport
- See `docs\CHECK_STDIO.md` for stdio usage details. You can run via `npm run template:stdio` after building.

Release & CI
- `prepublishOnly` builds the package before publish.
- `scripts\npm\run.js` drives CI tasks (`npm run ci`); `.run\*.run.xml` contains JetBrains run configs.

#### 7) Quick file index for fast lookup
- Entry/template server: `src\template\start.ts`
- Tools: `src\template\tools\tools.ts`, handler `src\template\tools\handle-tool-call.ts`
- Prompts: `src\template\prompts\*.ts`
- Resources: `src\template\custom-resources.ts`
- HTTP server: `src\core\web\server-http.ts`
- MCP core: `src\core\mcp\*.ts`, `src\core\init-mcp-server.ts`
- Config: `config\default.yaml`, bootstrap `src\core\bootstrap\init-config.ts`
- Errors: `src\core\errors\*.ts`
- Logging: `src\core\logger.ts`
- Tokens/Auth: `src\core\token\*`
- DB: `src\core\db\pg-db.ts`
- Consul: `src\core\consul\*`
- Tests: `src\tests\mcp\test-http.js`, `src\tests\mcp\test-sse.js`, cases `src\tests\mcp\test-cases.js`
- Stdio docs: `docs\CHECK_STDIO.md`

#### 8) Known defaults and pitfalls
- Default transport is HTTP. If you switch to `stdio`, ensure loggers and CORS assumptions are appropriate.
- If `webServer.auth.enabled` is true without tokens configured, all protected calls will fail.
- DB is optional; leaving `host: ''` intentionally disables DB checks and connection.
- Rate limits: High-volume tool calls can hit `rate-limiter-flexible`. Adjust `mcp.rateLimit` in config for load tests.
