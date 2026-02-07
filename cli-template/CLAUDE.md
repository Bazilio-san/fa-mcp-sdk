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
| `08-agent-tester-and-headless-api.md` | Agent Tester, Headless API, structured logging, automated testing |

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

This is the key phase. Based on observed behavior, adjust:

- Tool descriptions if the LLM picks the wrong tool or misunderstands its purpose
- Parameter schemas if the LLM sends wrong argument types or misses required params
- Agent prompt if the LLM doesn't follow the desired conversation style or logic
- Handler logic if tool results confuse the LLM or lack needed information
- Error messages if failures produce unhelpful agent responses

Each iteration: observe agent behavior → diagnose the root cause (prompt? description? schema? handler?) → fix → rebuild → re-test.

### Headless API Testing (Primary Method)

The headless API allows direct HTTP interaction with the Agent Tester without a browser. This is the **recommended method** for automated testing — faster, more reliable, and provides full trace data.

#### 1. Verify connection and tools

```bash
curl http://localhost:<port>/agent-tester/api/mcp/status
```

Response:
```json
{
  "connected": true,
  "servers": [{ "name": "localhost9876", "url": "...", "tools": [...], "toolCount": 3 }],
  "totalTools": 3
}
```

Check that `connected` is `true` and `totalTools` matches the expected number of tools.

#### 2. Send a test message (brief mode — default)

```bash
curl -X POST http://localhost:<port>/agent-tester/api/chat/test \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is the exchange rate of EUR to USD?",
    "mcpConfig": { "url": "http://localhost:<port>/mcp", "transport": "http", "headers": { "Authorization": "Bearer <token>" } }
  }'
```

Response includes the final message and a trace of tool calls:
```json
{
  "message": "The EUR/USD rate is 1.0847",
  "sessionId": "...",
  "trace": {
    "turns": [{
      "turn": 1,
      "tool_calls": [{ "name": "get_currency_rate", "arguments": { "quoteCurrency": "EUR", "baseCurrency": "USD" } }],
      "tool_results": [{ "name": "get_currency_rate", "result": { "rate": 1.0847 }, "duration_ms": 230 }]
    }],
    "total_turns": 2,
    "total_duration_ms": 1850,
    "tools_used": ["get_currency_rate"]
  }
}
```

Brief mode shows tool calls and results — enough for most debugging. No LLM internals.

#### 3. Verbose mode — when brief isn't enough

If the agent doesn't call the expected tool, or the response is unexpected and the brief trace doesn't explain why:

```bash
curl -X POST "http://localhost:<port>/agent-tester/api/chat/test?verbose=true" \
  -H "Content-Type: application/json" \
  -d '{ "message": "...", "mcpConfig": { ... } }'
```

Verbose trace adds per-turn LLM details: `model`, `messages_count`, `finish_reason`, `content` preview, `usage` (token counts).

#### 4. Size limit overrides

Default limits: 4000 chars per tool result, 50000 chars total trace. Override with query params:

```
POST /agent-tester/api/chat/test?maxResultChars=8000&maxTraceChars=100000
```

When the total trace exceeds the limit, older turns are collapsed to summaries.

#### 5. Structured JSON logging (optional)

For real-time monitoring of the agent during testing, start the server with the `--log-json` flag:

```bash
npm run cb && npm start -- --log-json
```

Or via environment variable: `AGENT_TESTER_LOG_JSON=true npm start`

Each agent event is emitted as a single-line JSON object on stdout:
```
{"event":"tool_call","name":"get_currency_rate","arguments":{"quoteCurrency":"EUR"},"timestamp":"..."}
{"event":"tool_result","name":"get_currency_rate","result":{"rate":1.0847},"duration_ms":230,"timestamp":"..."}
{"event":"response","message":"The EUR/USD rate is...","tools_used":["get_currency_rate"],"duration_ms":1850}
```

Default mode (without `--log-json`) keeps the colored text logs for human debugging.

#### Headless testing workflow summary

```
1. npm run cb && npm start
2. GET  /agent-tester/api/mcp/status         → verify tools loaded
3. POST /agent-tester/api/chat/test           → send message, get response + trace
4. Analyze trace: correct tool? correct args? expected result?
5. If unclear → retry with ?verbose=true
6. If issue found → fix code → stop server → npm run cb && npm start → re-test
```

### Playwright Testing (Fallback — UI Validation Only)

Use Playwright only when you need to verify UI-specific behavior: page layout, visual state, DOM interaction, CSS rendering. For tool testing, use the headless API above.

```
browser_navigate  → http://localhost:<port>/agent-tester
browser_snapshot  → verify page loaded, connection status visible
browser_type      → ref of message input, text: "your test question"
browser_click     → ref of send button
browser_wait_for  → wait for assistant response text
browser_snapshot  → verify response content and tool usage in DOM
```

### Testing Log

During automated testing, maintain a log file `claudedocs/test-log.md`. Write to it throughout the entire testing session — before each action and after each result. The log is a chronological narrative of what you did, why, and what happened.

Format:

```markdown
# Agent Tester — Test Log

## Session: 2025-08-15 14:32

### Iteration 1

Starting test session. Server built and running on port 9876.
Connected to MCP server: 3 tools detected (get_currency_rate, list_currencies, health_check).

**Testing get_currency_rate — basic case**
Sending: "What is the exchange rate of EUR to USD?"
Expected: numeric rate, mentions EUR and USD.
Received: "The current EUR/USD exchange rate is 1.0847"
Tools used: get_currency_rate
Result: OK

**Testing get_currency_rate — invalid currency**
Sending: "Get rate for XYZ to USD"
Expected: error message about unknown currency.
Received: "I couldn't find the exchange rate. The currency code XYZ is not recognized."
Tools used: get_currency_rate
Result: OK

**Testing get_currency_rate — missing base currency default**
Sending: "What is the rate for THB?"
Expected: THB/USD rate (baseCurrency defaults to USD).
Received: "I need to know which currency you want to convert THB to. Could you specify?"
Tools used: none
Result: FAIL — LLM did not use default baseCurrency, asked for clarification instead.

**Diagnosis**: The tool description says "baseCurrency - optional", but doesn't mention the default value.
**Fix**: Adding "defaults to USD if not specified" to baseCurrency description in tools.ts.

Stopping server. Rebuilding...
Build OK. Server restarted.

### Iteration 2

**Re-testing get_currency_rate — missing base currency default**
Sending: "What is the rate for THB?"
Received: "The current THB/USD exchange rate is 0.0291"
Tools used: get_currency_rate
Result: OK — LLM now uses USD as default.

...
```

This log serves as:
- **Audit trail** — what was tested, what passed, what failed
- **Decision record** — why each change was made (e.g., "changed description because LLM didn't understand default value")
- **Progress tracker** — which tools/scenarios are covered, which remain
- **Handoff document** — if the session is interrupted, the next session can read the log and continue
