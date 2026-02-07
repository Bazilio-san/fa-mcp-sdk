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
  "systemPrompt": "optional system prompt override",
  "modelConfig": {
    "model": "gpt-4o",
    "temperature": 0.3,
    "maxTokens": 4096,
    "maxTurns": 10
  }
}
```

Only `message` is required. `mcpConfig` is required for tool calls.

#### Brief Response (default)

```json
{
  "message": "The EUR/USD rate is 1.0847",
  "sessionId": "abc-123",
  "trace": {
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

### Sessions

The headless API shares sessions with the chat UI. To start a fresh conversation, omit `sessionId`. To continue an existing conversation, pass `sessionId` from a previous response.

## Structured JSON Logging

For real-time monitoring of agent events during testing, start the server with the `--log-json` flag:

```bash
npm start -- --log-json
# or via environment variable:
AGENT_TESTER_LOG_JSON=true npm start
```

Each agent event is emitted as a single-line JSON object on stdout:

```
{"event":"tool_call","name":"get_currency_rate","arguments":{"quoteCurrency":"EUR"},"timestamp":"2025-08-15T14:32:00.000Z"}
{"event":"tool_result","name":"get_currency_rate","result":{"rate":1.0847},"duration_ms":230,"timestamp":"2025-08-15T14:32:00.230Z"}
{"event":"llm_response","turn":2,"finish_reason":"stop","tool_calls":[],"has_content":true,"timestamp":"2025-08-15T14:32:01.500Z"}
{"event":"response","message":"The EUR/USD rate is 1.0847","tools_used":["get_currency_rate"],"duration_ms":1850}
```

**Default mode** (without `--log-json`) keeps the colored text logs for human debugging. The flag affects only agent tester events — other server logs (startup, auth, MCP protocol) continue in their normal format.

## Automated Testing with Claude Code

The Headless API is designed for CLI automation tools like Claude Code. The typical automated testing workflow:

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
