# Changes: 0.4.72 → 0.4.73

- **From commit:** `8b408c6` (v0.4.72)
- **To commit:** `b59ff46` (v0.4.73)
- **Generated:** 2026-05-06
- **Commits in range:** 3

## Summary

Adds a configurable JWT TTL for tokens auto-issued by the Agent Tester, with client-side refresh
in the chat UI and retry handling for agent self-authentication. The Agent Tester docs and the
`/upgrade-guide` skill shipped to your MCP were updated accordingly.

## Changed Files

- [M] config/default.yaml — new `agentTester.tokenTTLSec` key
- [M] config/_local.yaml — new `agentTester.tokenTTLSec` key
- [M] config/custom-environment-variables.yaml — `AGENT_TESTER_TOKEN_TTL_SEC` env mapping
- [M] FA-MCP-SDK-DOC/04-authentication.md
- [M] FA-MCP-SDK-DOC/08-agent-tester-and-headless-api.md
- [M] .claude/skills/upgrade-guide/SKILL.md
- [M] src/core/_types_/config.ts — `IAgentTesterConfig.tokenTTLSec?: number`
- [M] src/core/agent-tester/agent-tester-router.ts — token TTL wiring, refresh endpoint
- [M] src/core/agent-tester/services/TesterMcpClientService.ts — agent self-auth retry
- [M] src/core/web/static/agent-tester/script.js — UI token refresh loop

## 🔧 Configuration Changes

config/default.yaml, config/_local.yaml:

- `agentTester.tokenTTLSec` — added (default `1800` seconds, 30 min). Mirror this key in your MCP's
  own `config/*.yaml` if you want to override the default TTL.

config/custom-environment-variables.yaml:

- `agentTester.tokenTTLSec` — added env mapping `AGENT_TESTER_TOKEN_TTL_SEC` (number)

## Commits

- `55bbc51` Implement JWT refresh logic, token TTL configuration, and enhance agent self-authentication retries.
- `36a1543` 0.4.73
- `b59ff46` Add `change-history` skill to generate compact SDK update guides.
