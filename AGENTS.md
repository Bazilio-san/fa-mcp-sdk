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
npm run lint           # oxlint
npm run lint:fix       # oxlint --fix
npm run format         # oxfmt --check
npm run format:fix     # oxfmt
npm run quality        # lint + format check
npm run quality:fix    # auto-fix + format
npm run typecheck      # tsc --noEmit

# Run the template server (HTTP mode)
npm run build && npm start   # → node dist/template/start.js (http://localhost:<port>)
npm run template:stdio       # STDIO transport (for Claude Desktop)

# Token generator UI
npm run token-gen      # starts token generation server at /admin

# JWT token generation (CLI)
node scripts/generate-jwt.js -u <username> -ttl <duration> [-s <service>] [-p <params>]
# duration: <N>s | <N>m | <N>d | <N>y
# example: node scripts/generate-jwt.js -u admin -ttl 30d -s my-mcp -p "role=admin;team=ops"

# JWT generation API (HTTP endpoint, requires webServer.genJwtApiEnable: true)
# POST /gen-jwt  {"username":"user","ttl":"30d","service":"svc","params":"key=val"}

# Tests (no jest — node's built-in runner via .test.mjs)
npm run test:jwt          # build + node tests/jwt.test.mjs
npm run test:ip-check     # build + node tests/ip-check.test.mjs
node tests/jwt.test.mjs   # single suite (run `npm run build` first)

# MCP transport integration (manual, against a running server — `npm run build && npm start` first):
node src/tests/mcp/test-http.js    # HTTP/StreamableHTTP transport
node src/tests/mcp/test-sse.js     # SSE transport
node src/tests/mcp/test-stdio.js   # STDIO transport
```

## JWT Token Generation (Skill /gen-jwt)

Generate JWT tokens for MCP server authentication using the `/gen-jwt` skill.
Triggers: user asks to generate/create a JWT token, mentions "jwt", "token for user", "токен для", "сгенерируй токен для".

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
3. `jwtToken` — AES-256-CTR decrypt + JSON.parse (optional IP restriction via `isCheckIP`)
4. `custom` — user-defined validator (fallback after any failure)

See `src/core/auth/multi-auth.ts`.

### Config System

`AppConfig` (`src/core/_types_/config.ts`) composes: `IWebServerConfig`, `IMCPConfig`, `ILoggerConfig`, `IAgentTesterConfig`, `IAFDatabasesConfig`, `ISwaggerConfig`, `ICacheConfig`, `IADConfig`. Config is loaded by the `config` npm package from YAML files with environment variable overrides defined in `config/custom-environment-variables.yaml`.

**Schema changes in `config/default.yaml` MUST be mirrored in every `config/*.yaml`
(including `_local.yaml` — ask user if unreadable) and in `src/core/_types_/config.ts`.
Grep the old key across `config/` + types before finishing.**

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

## Editing files in `.claude/` (Skill /edit-claude-files)

Any edit or new file under `.claude/**` (SKILL.md, scripts, hooks, agents, `settings.json`) is blocked
by `settings.json` — direct `Write`/`Edit` will fail. Invoke the `/edit-claude-files` skill, which
describes the required `scripts/fcp.js` temp-copy protocol.

## MCP Apps Reference Clone (`scripts/clone-mcp-ext-apps.js`)

Shared helper used by every MCP Apps skill (`/update-mcp-apps-spec` here, and `/mcp-app-create` +
`/mcp-app-add-to-server` in generated projects). It clones or refreshes
`https://github.com/modelcontextprotocol/ext-apps.git` into `./mcp-ext-apps/` at the project root
(gitignored, persistent — never deleted by the script), optionally pins to the latest released
`@modelcontextprotocol/ext-apps` tag, and emits machine-readable metadata for downstream callers.

```bash
node scripts/clone-mcp-ext-apps.js                    # clone on first run, pull main otherwise
node scripts/clone-mcp-ext-apps.js --tag latest       # also checkout the latest npm tag
node scripts/clone-mcp-ext-apps.js --tag v1.7.2       # checkout a specific tag
node scripts/clone-mcp-ext-apps.js --json             # JSON output (path, ref, commit, version)
node scripts/clone-mcp-ext-apps.js --list-examples    # include examples/* metadata in JSON
```

The script is copied verbatim into projects generated by `fa-mcp`, so the relative path
`scripts/clone-mcp-ext-apps.js` works identically in this SDK repo and in any generated MCP server.

## MCP Apps Spec Digest (Skill /update-mcp-apps-spec)

Regenerates `cli-template/FA-MCP-SDK-DOC/10-mcp-apps.md` — the self-contained digest of the MCP Apps
protocol + SDK (`@modelcontextprotocol/ext-apps`). The skill invokes
`scripts/clone-mcp-ext-apps.js --tag latest --json --list-examples` to pin and refresh the local
`mcp-ext-apps/` checkout, reads the normative spec (`specification/2026-01-26/apps.mdx`), the SDK
surface (`src/app.ts`, `src/server/index.ts`, `src/spec.types.ts`, React hooks), and supporting
docs, then rewrites the digest with the canonical lifecycle diagrams (verbatim mermaid), protocol
contract, API reference, patterns, and a reference index. Also refreshes the matching rows in
`cli-template/FA-MCP-SDK-DOC/00-FA-MCP-SDK-index.md` and `cli-template/CLAUDE.md`.

Triggers: user asks to "update MCP apps doc", "refresh MCP apps spec", "regenerate
10-mcp-apps.md", or notes that the MCP Apps specification has changed upstream. The skill only
touches the digest + two index files — it does NOT modify `src/core/**` or scaffold MCP App tools.

## Formatting

MD lines ≤120 chars. Break at 120. Target 100-120. No short lines (60-80). Fill to ~120.
Exceptions: URLs, code blocks, tables — no wrap.
