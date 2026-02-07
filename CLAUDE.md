# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

fa-mcp-sdk is a TypeScript framework and CLI for building enterprise MCP (Model Context Protocol) servers. It has two roles:

1. **CLI generator** (`fa-mcp` command) — scaffolds new MCP server projects from `src/template/`
2. **Core library** (`fa-mcp-sdk` package) — provides auth, transport, config, DB, logging, and other infrastructure consumed by generated projects

## Commands

```bash
# Build
npm run build          # tsc + copy static assets to dist/
npm run cb             # clean dist/ + build
npm run dev            # tsc --watch

# Lint & typecheck
npm run lint           # eslint
npm run lint:fix       # eslint --fix
npm run typecheck      # tsc --noEmit

# Run the template server (HTTP mode)
npm run build && npm start   # → node dist/template/start.js (http://localhost:<port>)
npm run template:stdio       # STDIO transport (for Claude Desktop)

# Token generator UI
npm run token-gen      # starts token generation server at /admin

# Tests
npx jest               # run all tests
npx jest tests/path/to/file.test.ts   # single test file
```

**To start/stop the dev server**: build first (`npm run build`), then `npm start`. Stop with Ctrl+C. 
The server port is configured in `config/default.yaml` under `webServer.port`. Default port is 9876.

To force the server to stop the server, it is convenient to use `node scripts\kill-port.js 9876`.

## Architecture

### Source Layout

- **`src/core/`** — framework core, exported as library via `src/core/index.ts` (barrel file)
- **`src/template/`** — template project that `fa-mcp` CLI copies into new projects
- **`config/`** — YAML config files (default → development/production/test overrides → env vars)

### Key Subsystems in `src/core/`

| Directory | Purpose |
|-----------|---------|
| `bootstrap/` | Config loading (`init-config.ts` → `appConfig`), dotenv, startup diagnostics |
| `auth/` | Multi-auth system: permanent tokens, basic, JWT, custom validator |
| `mcp/` | MCP server creation, STDIO transport, prompts, resources |
| `web/` | Express HTTP server, SSE transport, admin router, CORS, Swagger |
| `agent-tester/` | Built-in chat UI for testing MCP tools with an LLM |
| `db/` | PostgreSQL utilities with pgvector support |
| `consul/` | Consul service discovery registration |
| `utils/testing/` | MCP test clients (HTTP, SSE, STDIO, StreamableHTTP) |

### Auth Order

Authentication is detected from the `Authorization` header format, not tried sequentially. The `authOrder` priority (used for sorting configured methods) is:

1. `permanentServerTokens` — O(1) set lookup
2. `basic` — base64 decode
3. `jwtToken` — AES-256-CTR decrypt + JSON.parse
4. `custom` — user-defined validator (fallback after any failure)

See `src/core/auth/multi-auth.ts`.

### Config System

`AppConfig` (`src/core/_types_/config.ts`) composes: `IWebServerConfig`, `IMCPConfig`, `ILoggerConfig`, `IAgentTesterConfig`, `IAFDatabasesConfig`, `ISwaggerConfig`, `ICacheConfig`, `IADConfig`. Config is loaded by the `config` npm package from YAML files with environment variable overrides defined in `config/custom-environment-variables.yaml`.

### MCP Transports

- **HTTP/SSE** (`src/core/web/server-http.ts`) — Express server, endpoints: `/mcp/*`, `/admin`, `/docs`, `/health`, `/agent-tester`
- **STDIO** (`src/core/mcp/server-stdio.ts`) — JSON-RPC over stdin/stdout for Claude Desktop

### Import Conventions

```typescript
// Always use .js extension in imports (ESM)
import { appConfig, initMcpServer } from '../core/index.js';

// Logger: sublogger pattern
import { logger as lgr } from '../core/logger.js';
const logger = lgr.getSubLogger({ name: chalk.cyan('module-name') });
```

## Testing Visual Components

The Agent Tester UI (`/agent-tester`) and other visual components must be tested using the **MCP Playwright** server — use `browser_navigate`, `browser_snapshot`, `browser_take_screenshot`, and other Playwright tools to verify UI changes. The dev server must be running first (`npm run build && npm start`).
