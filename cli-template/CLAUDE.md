# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An MCP (Model Context Protocol) server built on the `fa-mcp-sdk` framework. It exposes tools, prompts, and resources to AI agents via STDIO or HTTP/SSE transports.

## Commands

```bash
# Build & run
npm run build              # tsc
npm run cb                 # clean dist/ + build
npm start                  # node dist/src/start.js (HTTP mode)
node dist/src/start.js stdio   # STDIO mode (Claude Desktop)

# Lint & typecheck
npm run lint               # eslint
npm run lint:fix           # eslint --fix
npm run typecheck          # tsc --noEmit

# Tests
npm test                   # jest (all tests)
npm run test:mcp           # STDIO transport tests
npm run test:mcp-http      # HTTP transport tests
npm run test:mcp-sse       # SSE transport tests
npx jest tests/path/to/file.test.ts   # single test file

# Utilities
npm run generate-token     # JWT token generator UI
npm run consul:unreg       # deregister from Consul
```

**Start/stop the server**: `npm run build && npm start`. Stop with Ctrl+C. Port is in `config/default.yaml` → `webServer.port`. Force stop: `node scripts/kill-port.js <port>`.

**Server endpoints** (HTTP mode): `/mcp/*` (MCP protocol), `/docs` (Swagger UI), `/admin` (token generator), `/health`, `/agent-tester` (chat UI for testing tools).

## Architecture

```
src/
├── start.ts                  # Entry point — calls initMcpServer()
├── _types_/custom-config.ts  # Custom AppConfig extensions
├── tools/
│   ├── tools.ts              # Tool[] definitions (name, inputSchema)
│   └── handle-tool-call.ts   # Tool execution logic (switch on name)
├── prompts/
│   ├── agent-brief.ts        # Short agent description
│   ├── agent-prompt.ts       # Full system prompt
│   └── custom-prompts.ts     # Additional IPromptData[]
├── api/router.ts             # REST endpoints (tsoa decorators)
└── custom-resources.ts       # MCP resources (IResourceData[])

config/
├── default.yaml              # Base config
├── development.yaml          # Dev overrides
├── production.yaml           # Prod overrides
├── local.yaml                # Local secrets (gitignored)
└── custom-environment-variables.yaml  # Env var → config mapping

tests/mcp/                    # MCP tool tests (STDIO, HTTP, SSE)
```

### Key Patterns

```typescript
// All imports from fa-mcp-sdk use .js extensions (ESM)
import { initMcpServer, appConfig, formatToolResult, ToolExecutionError } from 'fa-mcp-sdk';

// Tool handler receives headers and JWT payload
export const handleToolCall = async (params: IToolHandlerParams): Promise<any> => {
  const { name, arguments: args, headers, payload, transport } = params;
  // payload.user available when JWT auth enabled
};

// REST API uses tsoa decorators
@Route('api') export class MyController { @Get('endpoint') ... }
```

### Config System

Priority: environment variables > local.yaml > {NODE_ENV}.yaml > default.yaml. Access via `appConfig` from `fa-mcp-sdk`. Extend the type in `src/_types_/custom-config.ts`.

### Auth Order

When multiple auth methods configured, detection from `Authorization` header:
1. `permanentServerTokens` — static tokens (O(1) lookup)
2. `basic` — base64 username:password
3. `jwtToken` — encrypted JWT
4. `custom` — user-defined validator (fallback)

## Framework Documentation

Detailed fa-mcp-sdk docs are in `FA-MCP-SDK-DOC/`:

| File | When to Read |
|------|-------------|
| `00-FA-MCP-SDK-index.md` | Quick reference, all exports, project structure |
| `01-getting-started.md` | `initMcpServer()`, `McpServerData`, `IToolHandlerParams` |
| `02-1-tools-and-api.md` | Tool definitions, REST API with tsoa |
| `02-2-prompts-and-resources.md` | Prompts, resources, `ITransportContext` |
| `03-configuration.md` | `appConfig`, YAML config, DB, cache |
| `04-authentication.md` | JWT, Basic auth, permanent tokens |
| `06-utilities.md` | Error handling, logging, Consul |
| `07-testing-and-operations.md` | Test clients (STDIO, HTTP, SSE, Streamable HTTP) |

## Development and Testing Through Agent Tester

The Agent Tester is the primary feedback loop for developing MCP server tools. It validates not just whether a tool "works", but the full agent experience: how the LLM interprets descriptions, selects tools, passes arguments, and presents results to the user.

### What Gets Tested and Refined

Testing through the Agent Tester covers all aspects of the MCP server simultaneously:

- **Tool architecture** — are the tools decomposed correctly? Should one tool be split into two, or two merged?
- **Agent prompt** — does the system prompt guide the LLM to use tools correctly and respond clearly?
- **Tool descriptions** — does the LLM understand when and why to call each tool?
- **Parameter design** — are parameter names, types, required/optional flags intuitive for the LLM?
- **Parameter validation** — does the handler reject invalid input gracefully?
- **Response format** — does `formatToolResult()` return data the LLM can interpret and relay to the user?
- **Error handling** — does the agent explain errors clearly instead of showing raw stack traces?
- **Edge cases** — missing params, invalid values, service unavailability

### Three-Phase Workflow

#### Phase 1: Initial Architecture

Design tools, prompts, parameters, and handler logic based on the task requirements. Implement a first working version:

```bash
npm run cb && npm start
```

#### Phase 2: Basic Functionality

Verify everything compiles, the server starts, tools appear in the Agent Tester, and basic calls succeed. Fix crashes, connection errors, and missing tools.

#### Phase 3: Iterative Refinement via Agent Tester

This is the key phase. Use the Agent Tester (via MCP Playwright) to interact with the agent as a real user would. Based on observed behavior, adjust:

- Tool descriptions if the LLM picks the wrong tool or misunderstands its purpose
- Parameter schemas if the LLM sends wrong argument types or misses required params
- Agent prompt if the LLM doesn't follow the desired conversation style or logic
- Handler logic if tool results confuse the LLM or lack needed information
- Error messages if failures produce unhelpful agent responses

Each iteration: observe agent behavior → diagnose the root cause (prompt? description? schema? handler?) → fix → re-test.

### Playwright Testing Scenario

1. **Build and start the server**:
   ```bash
   npm run cb && npm start
   ```

2. **Open Agent Tester** in Playwright:
   ```
   browser_navigate → http://localhost:<port>/agent-tester
   ```

3. **Wait for auto-connection** — the tester auto-connects to the local MCP server and auto-fills auth headers if configured.

4. **Verify tools are loaded** — check that the connection status shows the expected number of tools (e.g., "N tools connected").

5. **Test each tool via chat**. Type a natural-language request in the chat input and send it. The AI agent will call the appropriate MCP tool. Verify the response contains expected data.

   Example test sequence for a currency rate tool:
   ```
   User:  "What is the exchange rate of EUR to USD?"
   Check: Response contains a numeric rate and mentions EUR/USD

   User:  "Convert THB to RUB"
   Check: Response contains a rate for THB/RUB pair

   User:  "Get rate for invalid currency XYZ"
   Check: Response indicates an error or unknown currency
   ```

6. **Validate through Playwright assertions**:
   - Use `browser_snapshot` to capture the page state after each message
   - Verify the assistant response appears in the chat (look for `listitem` or message elements)
   - Check that tool usage metadata appears (e.g., "Tools used: get_currency_rate")
   - Check no error toasts appeared for valid requests

7. **Stop the server** when testing is complete.

### Playwright Workflow Summary

```
browser_navigate  → http://localhost:<port>/agent-tester
browser_snapshot  → verify "N tools connected" in status
browser_type      → ref of message input, text: "your test question"
browser_click     → ref of send button
browser_wait_for  → wait for assistant response text
browser_snapshot  → verify response content and tool usage
```

Repeat steps for each tool and edge case. Adjust tools, prompts, descriptions, and handler logic based on results.
