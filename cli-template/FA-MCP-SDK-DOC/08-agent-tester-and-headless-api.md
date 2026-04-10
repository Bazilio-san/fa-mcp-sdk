# Agent Tester and Headless API

## Overview

The Agent Tester is a built-in AI agent system for developing and refining MCP server tools. It goes beyond functional testing — it validates the **full agent experience**: how the LLM interprets tool descriptions, selects tools, passes arguments, and presents results.

The Headless API provides programmatic access to the Agent Tester without a browser. It enables CLI-based automated testing and returns structured trace data for every tool call, argument, result, and LLM decision.

## Developing MCP Servers as Agents

An MCP server is not just a set of tools — it is an **agent interface**. The LLM acts as the agent, deciding which tools to call, with what arguments, and how to interpret results. This means the quality of the agent experience depends on:

- **Tool descriptions** — the LLM reads them to decide when and why to call a tool
- **Parameter schemas** — names, types, required/optional flags, and default value documentation guide the LLM's argument construction
- **Response format** — `formatToolResult()` output must be structured so the LLM can interpret and relay it to the user
- **Agent prompt** — the system prompt shapes the LLM's conversation style, tool usage logic, and error handling behavior
- **Tool decomposition** — whether one tool should be split into two, or two merged into one

All of these aspects are **invisible to unit tests**. A tool can pass all unit tests and still produce a poor agent experience because the LLM misinterprets the description, sends wrong argument types, or doesn't understand the response format.

The Agent Tester closes this gap by running the **full agent loop**: user message → LLM reasoning → tool selection → tool execution → LLM interpretation → user response.

## Three-Phase Development Workflow

### Phase 1: Initial Architecture

Design tools, prompts, parameters, and handler logic based on task requirements. Implement a first working version:

```bash
npm run cb && npm start
```

### Phase 2: Basic Functionality

Verify compilation, server startup, tool registration, and basic calls. Fix crashes, connection errors, and missing tools.

### Phase 3: Iterative Refinement

This is the key phase. Send test messages through the Agent Tester, observe the agent's behavior, diagnose issues, and refine:

```
observe agent behavior → diagnose root cause → fix → rebuild → re-test
```

Root cause categories:
- **Tool description** — LLM picks wrong tool or misunderstands purpose
- **Parameter schema** — LLM sends wrong types or misses required params
- **Agent prompt** — LLM doesn't follow desired conversation style
- **Handler logic** — tool results confuse the LLM
- **Error messages** — failures produce unhelpful responses

## Authentication (`agentTester.useAuth`)

When `agentTester.useAuth` is `true`, the Agent Tester is protected by the full multi-auth middleware — the same authentication chain used for MCP endpoints (`permanentServerTokens` / `basic` / `jwtToken` / `custom`).

### How It Works

**Browser access:** When a user opens `/agent-tester` in a browser, the page loads normally (static assets are served without auth). The frontend checks `GET /api/auth/status` and displays a **login dialog** if the user is not authenticated. The dialog adapts to configured auth methods:

- If `permanentServerTokens` or `jwtToken` is configured — shows a "Token" input
- If `basic` auth is configured — shows "Username" + "Password" inputs
- If both are configured — shows tabs to switch between methods

After successful login via `POST /api/auth/login`, the server issues an httpOnly session cookie (`__at_sid`). All subsequent API requests from the browser include this cookie automatically. The session is valid for 8 hours. A logout button appears in the header.

**Headless / CLI access:** Headless API consumers (curl, scripts, Claude Code) bypass the login dialog entirely. They pass an `Authorization` header with each request, which is validated by the standard `authMW`. No session cookie is needed.

### Configuration

```yaml
agentTester:
  useAuth: true   # Show login screen for browser, require auth for API

webServer:
  auth:
    enabled: true
    permanentServerTokens: ['my-secret-token']
    # and/or basic, jwtToken — any configured method will be available
```

Or via environment variable: `AGENT_TESTER_USE_AUTH=true`

When `useAuth` is `false` (default), the Agent Tester is accessible without any authentication.

### Auth API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/status` | GET | Returns `{ authRequired, authenticated, methods }` |
| `/api/auth/login` | POST | Validates credentials, sets session cookie |
| `/api/auth/logout` | POST | Destroys session, clears cookie |

**Login request body:**

```json
// Token-based (permanent token or JWT)
{ "token": "my-secret-token" }

// Basic auth
{ "username": "admin", "password": "secret" }
```

### Headless Client Example

```bash
# Access Agent Tester API with token (no login needed)
curl -H "Authorization: Bearer my-secret-token" http://localhost:9876/agent-tester/api/mcp/status

# Headless test with token
curl -X POST http://localhost:9876/agent-tester/api/chat/test \
  -H "Authorization: Bearer my-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","mcpConfig":{"url":"http://localhost:9876/mcp","transport":"http"}}'
```

## Disabled State

When `agentTester.enabled` is `false` (or not set), all `/agent-tester/*` endpoints — including the Headless API — return HTTP 404:

```json
{
  "error": "Not found"
}
```

This prevents disclosing the existence of the Agent Tester to external users.

To enable, developer can use one of:

- **ENV**: `AGENT_TESTER_ENABLED=true`
- **Config file** `config/local.yaml`:
  ```yaml
  agentTester:
    enabled: true
  ```

### Hiding Footer Link Without Disabling Tester

To keep the Agent Tester functional (accessible directly by URL) but hide the link from the home page footer, use `showFooterLink: false`:

```yaml
agentTester:
  enabled: true
  showFooterLink: false   # Tester works, but footer link is hidden
```

When `showFooterLink` is omitted or `true` (default), the footer link is shown as usual.

**For Claude Code**: When you receive a 404 response on `/agent-tester/*`, the Agent Tester may be disabled. Inform the developer and suggest enabling it via `agentTester.enabled: true` in `config/local.yaml` or ENV `AGENT_TESTER_ENABLED=true`. The developer decides whether to turn it on. If the developer's prompt or instructions explicitly say not to mention Agent Tester enablement, respect that and stay silent.

## LLM Availability Check

Before using the Agent Tester or Headless API, verify that the OpenAI API key is configured and works:

```bash
npm run check-llm
```

The script checks that `agentTester.openAi.apiKey` is set and makes a minimal `chat.completions.create` request (max_tokens: 1) to verify the key works. Prints `OK` on success, `FAIL: <reason>` on failure. Exit code `0` = success, `1` = failure.

For custom OpenAI-compatible endpoints where `gpt-4o-mini` doesn't exist, pass the model name:

```bash
npm run check-llm -- my-custom-model
```

**For Claude Code**: When the development prompt or instructions mention testing with the Headless API or Agent Tester, run `npm run check-llm` before starting any Agent Tester work. If the script exits with a non-zero code, inform the developer about the issue and ask them to fix the configuration before proceeding.

## Headless API Reference

### Connection Verification

```
GET /agent-tester/api/mcp/status
```

Returns connection state and all available tools without going through the UI:

```json
{
  "connected": true,
  "servers": [
    {
      "name": "localhost9876",
      "url": "http://localhost:9876/mcp",
      "transport": "http",
      "tools": [
        { "name": "get_currency_rate", "description": "Get current cross-rate...", "inputSchema": {} }
      ],
      "toolCount": 1
    }
  ],
  "totalTools": 1
}
```

### Headless Chat Test

```
POST /agent-tester/api/chat/test
```

Same request body as `POST /api/chat/message`, but returns a **structured trace** of all intermediate steps.

#### Request Body

```json
{
  "message": "What is the exchange rate of EUR to USD?",
  "mcpConfig": {
    "url": "http://localhost:9876/mcp",
    "transport": "http",
    "headers": { "Authorization": "Bearer <token>" }
  },
  "sessionId": "optional-session-id",
  "agentPrompt": "optional agent prompt override",
  "customPrompt": "optional additional instructions appended after agentPrompt",
  "modelConfig": {
    "model": "gpt-4o",
    "temperature": 0.3,
    "maxTokens": 4096,
    "maxTurns": 10
  }
}
```

Only `message` is required. `mcpConfig` is required for tool calls.

| Field | Required | Description |
|-------|----------|-------------|
| `message` | yes | User message to send to the agent |
| `mcpConfig` | no | MCP server connection config (required for tool calls) |
| `sessionId` | no | Session ID for multi-turn conversations; omit to start fresh |
| `agentPrompt` | no | Agent prompt to send to the LLM as the system prompt. When provided, **replaces** the MCP server's `agent_prompt`. When omitted, the MCP server's `agent_prompt` is used (if available), otherwise a built-in default |
| `customPrompt` | no | Additional instructions appended after `agentPrompt`. Use for per-request modifiers without replacing the main prompt |
| `modelConfig` | no | LLM model settings (model name, temperature, maxTokens, maxTurns) |

#### Brief Response (default)

```json
{
  "message": "The EUR/USD rate is 1.0847",
  "sessionId": "abc-123",
  "trace": {
    "system_prompt_sent": "You are a currency assistant...\n\nBe concise.",
    "turns": [
      {
        "turn": 1,
        "tool_calls": [
          { "name": "get_currency_rate", "arguments": { "quoteCurrency": "EUR", "baseCurrency": "USD" } }
        ],
        "tool_results": [
          { "name": "get_currency_rate", "result": { "symbol": "EURUSD", "rate": 1.0847 }, "duration_ms": 230 }
        ]
      }
    ],
    "total_turns": 2,
    "total_duration_ms": 1850,
    "tools_used": ["get_currency_rate"]
  }
}
```

The `system_prompt_sent` field contains the **final system prompt** that was sent to the LLM. Use it to verify exactly what the LLM received — especially when iterating on agent prompt variations.

Brief mode shows the tool interaction chain: which tools were called, with what arguments, and what they returned. No LLM internals.

#### Verbose Response

```
POST /agent-tester/api/chat/test?verbose=true
```

Adds per-turn LLM request/response details:

```json
{
  "turns": [
    {
      "turn": 1,
      "llm_request": { "model": "gpt-4o", "messages_count": 3 },
      "llm_response": {
        "finish_reason": "tool_calls",
        "content": null,
        "usage": { "prompt_tokens": 450, "completion_tokens": 32, "total_tokens": 482 }
      },
      "tool_calls": [...],
      "tool_results": [...]
    }
  ]
}
```

Use verbose mode when:
- The agent doesn't call the expected tool and the brief trace doesn't explain why
- The agent loops without resolving (check `finish_reason`)
- Token usage is unexpectedly high
- The response is empty or unexpected

#### Size Limit Overrides

```
POST /agent-tester/api/chat/test?maxResultChars=8000&maxTraceChars=100000
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxResultChars` | 4000 | Max characters per tool result in trace |
| `maxTraceChars` | 50000 | Max total trace size; older turns are collapsed to summaries when exceeded |

### Prompt Assembly

The system prompt sent to the LLM is resolved by priority — the first available value wins:

```
request.agentPrompt  →  session.agentPrompt  →  MCP server's agent_prompt  →  built-in default
```

If `customPrompt` is provided, it is appended after the resolved prompt.

The final result is sent as `{ role: "system" }` to the LLM and returned in the trace as `system_prompt_sent`.

**Key principle:** when `agentPrompt` is passed in the request, it **replaces** the MCP server's `agent_prompt` entirely. This enables the iterative prompt refinement workflow:

1. Read the current `AGENT_PROMPT` from `src/prompts/agent-prompt.ts`
2. Send it as `agentPrompt` in the headless request
3. Evaluate the agent's response and trace
4. Modify the prompt, send again
5. When satisfied, write the best variant back to `src/prompts/agent-prompt.ts`

```bash
# Test current prompt
curl -X POST http://localhost:9876/agent-tester/api/chat/test \
  -H "Content-Type: application/json" \
  -d '{"message":"Get EUR/USD rate","agentPrompt":"You are a concise currency assistant. Use tools, reply in one sentence.","mcpConfig":{"url":"http://localhost:9876/mcp","transport":"http"}}'

# Try a different variation
curl -X POST http://localhost:9876/agent-tester/api/chat/test \
  -H "Content-Type: application/json" \
  -d '{"message":"Get EUR/USD rate","agentPrompt":"You are a financial analyst. Explain rates with market context and trends.","mcpConfig":{"url":"http://localhost:9876/mcp","transport":"http"}}'
```

Compare `system_prompt_sent` and agent responses between variations to find the optimal prompt. When omitting `agentPrompt`, the MCP server's own `agent_prompt` is used automatically — this tests the currently deployed prompt as-is.

### Sessions

The headless API shares sessions with the chat UI. To start a fresh conversation, omit `sessionId`. To continue an existing conversation, pass `sessionId` from a previous response.

## Structured JSON Logging (`agentTester.logJson`)

When `agentTester.logJson` is `true`, each agent event is emitted as a single-line JSON object on stdout — useful for real-time monitoring, debugging, and log aggregation.

Enable via config, CLI flag, or environment variable:

```yaml
# config/local.yaml
agentTester:
  logJson: true
```

```bash
npm start -- --log-json
# or
AGENT_TESTER_LOG_JSON=true npm start
```

Event types emitted:

```
{"event":"tool_call","name":"get_currency_rate","arguments":{"quoteCurrency":"EUR"},"timestamp":"2025-08-15T14:32:00.000Z"}
{"event":"tool_result","name":"get_currency_rate","result":{"rate":1.0847},"duration_ms":230,"timestamp":"2025-08-15T14:32:00.230Z"}
{"event":"llm_response","turn":2,"finish_reason":"stop","tool_calls":[],"has_content":true,"timestamp":"2025-08-15T14:32:01.500Z"}
{"event":"response","message":"The EUR/USD rate is 1.0847","tools_used":["get_currency_rate"],"duration_ms":1850}
```

**Default mode** (without `--log-json`) keeps the colored text logs for human debugging. The flag affects only agent tester events — other server logs (startup, auth, MCP protocol) continue in their normal format.

## Automated Testing with Claude Code

The Headless API is designed for CLI automation tools like Claude Code. The typical automated testing workflow:

0. Verify LLM availability: `npm run check-llm` (exit 0 = ready, non-zero = fix config first)
1. Build and start the server: `npm run cb && npm start`
2. Verify tools: `GET /agent-tester/api/mcp/status`
3. Send test messages: `POST /agent-tester/api/chat/test`
4. Analyze trace: correct tool? correct args? expected result?
5. If unclear: retry with `?verbose=true`
6. If issue found: fix code, rebuild, restart, re-test
7. Maintain a testing log at `claudedocs/test-log.md`

### Brief vs Verbose Strategy

**Default to brief mode.** The brief trace covers most debugging scenarios:
- Was the correct tool called?
- Were the arguments correct?
- Did the tool return the expected result?
- How many turns did the agent take?

**Switch to verbose** only when the brief trace doesn't explain the behavior:
- Tool was never called (check `finish_reason` — was it `stop` instead of `tool_calls`?)
- Wrong tool was called (check if the tool description is ambiguous)
- Agent loops (check per-turn `finish_reason` and token usage)
- Empty response (check if `content` is null across all turns)

## Agent Tester Chat UI

The Agent Tester also provides a web UI at `/agent-tester` for interactive testing. The UI auto-connects to the local MCP server and auto-fills auth headers if configured.

The chat UI uses `POST /api/chat/message` (which returns only the final response). The headless API uses `POST /api/chat/test` (which returns the response plus full trace data). Both share the same underlying agent logic and session storage.

## UI Test Selectors (`data-testid`)

For UI automation (Playwright, Cypress, Selenium) the Agent Tester page is annotated with stable `data-testid` attributes. Prefer these over CSS classes, DOM IDs, or label text — they are the documented contract and won't change with styling or copy edits.

### Naming Convention

All selectors use the `at-` prefix (short for "agent tester") in kebab-case:

```
at-<area>-<element>[-<modifier>]
```

Example: `at-auth-token-input`, `at-server-url`, `at-message-user`, `at-toast-success`.

Dynamic elements that map 1:1 to runtime data append the runtime key:

```
at-header-row-<headerName>     e.g. at-header-row-Authorization
at-header-input-<headerName>   e.g. at-header-input-X-Session-Id
at-message-<sender>            e.g. at-message-user, at-message-assistant
at-toast-<type>                e.g. at-toast-success, at-toast-error
```

### Selector Reference

**Auth overlay (shown when `agentTester.useAuth: true`)**

| testid | Element |
|---|---|
| `at-auth-overlay` | Root login overlay container |
| `at-auth-tabs` | Tab switcher (only rendered when multiple methods configured) |
| `at-auth-tab-token` | "Token" tab button |
| `at-auth-tab-basic` | "Login" tab button |
| `at-auth-token-form` | Token login form |
| `at-auth-token-input` | Token input field |
| `at-auth-token-submit` | Token submit button |
| `at-auth-basic-form` | Basic auth form |
| `at-auth-username` | Username input |
| `at-auth-password` | Password input |
| `at-auth-basic-submit` | Basic submit button |
| `at-auth-error` | Error message container |

**App shell**

| testid | Element |
|---|---|
| `at-app` | Root app container (hidden until authenticated) |
| `at-sidebar` | Sidebar (configuration panel) |
| `at-main` | Main chat area |
| `at-chat-header` | Chat header bar |

**Sidebar — connection form**

| testid | Element |
|---|---|
| `at-connection-form` | MCP connection form |
| `at-server-url` | MCP server URL input |
| `at-server-url-dropdown` | Saved URLs dropdown toggle |
| `at-server-url-dropdown-list` | Saved URLs dropdown panel |
| `at-server-url-add-new` | "Add new URL" menu item |
| `at-saved-urls-list` | Container for saved URL items |
| `at-saved-url-item` | Each saved URL row (dynamic) |
| `at-saved-url-text` | Clickable URL text within a row |
| `at-saved-url-delete` | Delete button for a saved URL |
| `at-transport` | Transport `<select>` (http / sse) |
| `at-connect-btn` | Connect button |
| `at-connected-servers` | Connection status bar container |
| `at-server-status-row` | Status row (dynamic, rendered after connect attempt) |
| `at-server-status-connected` | "X tools connected" badge |
| `at-server-status-disconnected` | "Disconnected" badge |
| `at-disconnect-btn` | Disconnect button |
| `at-reconnect-btn` | Reconnect button |

**Sidebar — HTTP headers section**

| testid | Element |
|---|---|
| `at-headers-section` | Headers section container |
| `at-dynamic-headers` | Headers list container |
| `at-header-row-<name>` | Row for a specific header (e.g. `at-header-row-Authorization`) |
| `at-header-input-<name>` | Input for a specific header value |

**Sidebar — model settings**

| testid | Element |
|---|---|
| `at-model-section` | Model section container |
| `at-model-select` | Model `<select>` |
| `at-custom-model-settings` | "Other..." custom model panel |
| `at-custom-base-url` | Custom base URL input |
| `at-custom-api-key` | Custom API key input |
| `at-custom-model-name` | Custom model name input |
| `at-model-temperature` | Temperature input |
| `at-model-max-tokens` | Max tokens input |
| `at-model-max-turns` | Max turns input |
| `at-tool-result-limit` | Tool result char limit input |

**Sidebar — prompts**

| testid | Element |
|---|---|
| `at-system-prompt` | Agent (system) prompt `<textarea>` |
| `at-system-prompt-enlarge` | Enlarge button for agent prompt |
| `at-custom-prompt` | Custom prompt `<textarea>` |
| `at-custom-prompt-enlarge` | Enlarge button for custom prompt |

**Chat header**

| testid | Element |
|---|---|
| `at-sidebar-toggle-mobile` | Mobile sidebar toggle |
| `at-default-format` | Default display format `<select>` (HTML / MD) |
| `at-theme-toggle` | Light/dark theme toggle |
| `at-clear-chat` | Clear chat button |
| `at-logout-btn` | Logout button (visible only when `useAuth` is true) |

**Chat area**

| testid | Element |
|---|---|
| `at-chat-messages` | Messages scroll container |
| `at-welcome-message` | Initial welcome card |
| `at-message-user` | User message bubble (one per message) |
| `at-message-assistant` | Assistant message bubble |
| `at-message-text-user` | Inner text element of a user message |
| `at-message-text-assistant` | Inner text element of an assistant message |
| `at-message-format-toggle` | HTML/MD format toggle on an assistant message |
| `at-typing-indicator` | Typing indicator (shown during LLM response) |
| `at-message-input` | Chat input `<textarea>` |
| `at-char-count` | Character counter span |
| `at-send-btn` | Send button |

**Modals and overlays**

| testid | Element |
|---|---|
| `at-prompt-modal` | Prompt enlarge modal overlay |
| `at-prompt-modal-title` | Modal title |
| `at-prompt-modal-textarea` | Modal text area |
| `at-prompt-modal-save` | Apply button |
| `at-prompt-modal-close` | Close button |
| `at-loading-overlay` | Global loading overlay |
| `at-header-tooltip` | Floating header description tooltip |
| `at-toast-container` | Toast notifications container |
| `at-toast-success` / `at-toast-error` / `at-toast-warning` / `at-toast-info` | Individual toast (dynamic) |

### Usage Examples

**Playwright**

```js
await page.goto('http://localhost:9876/agent-tester');

// Login when useAuth is enabled
await page.getByTestId('at-auth-token-input').fill(process.env.MCP_TOKEN);
await page.getByTestId('at-auth-token-submit').click();

// Wait for main app
await page.getByTestId('at-app').waitFor();

// Send a chat message
await page.getByTestId('at-message-input').fill('List all tools');
await page.getByTestId('at-send-btn').click();

// Assert an assistant reply appeared
await page.getByTestId('at-message-assistant').first().waitFor();
```

**Cypress**

```js
cy.visit('/agent-tester');
cy.get('[data-testid=at-auth-token-input]').type(Cypress.env('MCP_TOKEN'));
cy.get('[data-testid=at-auth-token-submit]').click();
cy.get('[data-testid=at-server-status-connected]').should('be.visible');
```

### Stability Guarantee

These test-ids are part of the public contract of the Agent Tester UI. Once added, a given id is not renamed or removed without a changelog entry. New elements are added with new ids as the UI grows. When authoring tests, prefer `data-testid` over:

- DOM `id` (may be shared with form `<label for>` pairs and collide across scopes)
- CSS class names (used for styling — may be renamed or removed during refactors)
- Visible text (localized / editable copy — changes break tests)
- XPath or positional selectors (brittle to layout changes)
