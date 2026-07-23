# Changelog

All notable changes to `fa-mcp-sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.23] - 2026-07-24

### Added

- **`webServer.cors.enabled` config flag** (default `true`). When left at `true` the CORS origin guard
  stays on and the `webServer.originHosts` allow-list is enforced (unlisted `Origin` → HTTP 403). Set it
  to `false` to disable the guard: the server then sends `Access-Control-Allow-Origin: *` on every
  response and answers preflight requests, so public endpoints work when fetched cross-origin from
  sandboxed iframes (MCP Apps widgets) whose `Origin` is `null` or a dynamic host subdomain.

### Changed

- **Empty-`originHosts` production check now applies only while the CORS guard is enabled.** With
  `webServer.cors.enabled: false` the empty allow-list no longer aborts `initMcpServer()`; instead the
  server logs a startup warning that all origins are allowed and must be protected by network policy.

## [0.12.16] - 2026-06-19

### Added

- **Tool-prompt selection in the home-page catalog viewer.** The prompts modal now shows the
  `tool_prompt` row only when at least one tool has a non-empty prompt (the server probes every
  tool honestly). The row offers a `details / [select]` control: picking a tool from the dropdown
  fetches and displays that tool's prompt. The template wires example prompts for `example_tool`
  and `example_search` via the new `src/template/prompts/tool-prompts.ts`.

## [0.12.13] - 2026-06-19

### Added

- **`tool_prompt` built-in prompt.** Returns a prompt scoped to one MCP tool. Has a required `tool`
  argument; content comes from the new optional `McpServerData.toolPrompt` function (gets the tool
  name in `args.tool`). Without it, a stub returns an empty string. `agent_prompt` is unchanged.

## [0.12.12] - 2026-06-19

### Fixed

- **Stateless "view content" in the home-page catalog.** `resources/read` and `prompts/get` are now
  sessionless too, so clicking a resource/prompt no longer fails with `-32600`. The viewer parses
  both JSON and SSE responses.

## [0.12.11] - 2026-06-15

### Fixed

- **Streamable HTTP catalog discovery without a session.** Allow
  `tools/list`, `resources/list`, and `prompts/list` requests without `MCP-Session-Id` by routing
  them through a one-shot stateless Streamable HTTP transport. Stateful requests, including
  `tools/call`, still require `initialize` and a valid session; requests carrying an unknown
  `MCP-Session-Id` continue to be rejected as invalid sessions.

## [0.12.1] - 2026-06-08

Precise diagnostics for `tools/call` input-schema violations, plus a config switch to disable input
validation entirely.

### Added

- **Per-field validation diagnostics.** A
  `-32602 Invalid params` error now carries a precise English diagnostic instead of the bare
  `"Invalid params"`. `error.message` reads `Invalid params: <field>: <reason>; …` and `error.data`
  gains `errorCount` plus an `errors[]` array (up to 8 items) of `{ field, reason, message }`. The
  `reason` is a stable ajv keyword (`type`, `required`, `enum`, `pattern`, …). Diagnostics name the
  field and the violated constraint, and report the actual JS type for type mismatches, but never echo
  the offending value (§13.3). The same enrichment applies to `outputSchema` violations (`-32603`).
  Ajv now runs with `allErrors: true` and `verbose: true`.
- **`mcp.tools.validateInput`** config flag (default `true`; env `MCP_TOOLS_VALIDATE_INPUT`). Set
  `false` to skip server-side validation of `tools/call` arguments against `inputSchema` — useful when
  tools self-validate or in trusted internal deployments. Does not affect `outputSchema` validation.

## [0.11.7] - 2026-06-03

JSON-RPC response tracing for the Streamable HTTP transport — so a `-32xxx` error that previously
only surfaced on the client now leaves a meaningful trace on the server. Additive and off by
default for success traffic; error traces are always on.

### Added

- **JSON-RPC response tracing.** A response tee on `POST /mcp` and on the
  `GET`/`DELETE` session routes captures the outgoing payload and parses it into JSON-RPC messages.
  The parser auto-detects the response shape from the body (plain `application/json` object/array,
  or the `data:` frames of an `text/event-stream` SSE stream) rather than the `Content-Type` header,
  because Node has already cleared the outgoing headers by the time the response `finish`es. Every
  JSON-RPC **error** is logged unconditionally with its HTTP status, request id, `code`, `message`,
  and (truncated) `data`, alongside the originating request summary. Successful results are logged
  only under `DEBUG=mcp-rpc` as a one-line summary, to avoid dumping large tool payloads. Capture is
  capped at 256 KB per response to bound memory on long SSE streams (the line is marked
  `[capture truncated]` when the cap is hit), and trace logging is wrapped so it can never break the
  actual response.

## [0.11.6] - 2026-06-03

Detailed connection / handshake tracing and session-lifecycle logging for the Streamable HTTP
transport, to diagnose why a client gets `-32600` ("no valid session") with nothing on the server.
Per-request dumps are gated behind a debug switch; the key lifecycle events always log.

### Added

- **Handshake tracing and session-lifecycle logging.** Session creation,
  closure (by the client and on transport close), and the no-session rejection now always log,
  including the active-session count and a short (8-char) session id. The `-32600` rejection path,
  previously silent, now explains *why* the session was rejected — the client must send `initialize`
  first or echo a valid `mcp-session-id` header — and reports when the supplied session id is
  unknown or expired. Verbose per-request dumps (JSON-RPC method, id, session routing, protocol
  version, `Accept` / `Content-Type`, auth presence, client IP) are gated behind `DEBUG=mcp-handshake`
  so they do not flood the log on every tool call.

## [0.11.5] - 2026-06-03

### Fixed

- **Agent Tester: tools lost after a page reload.** When the page was reloaded while the backend
  kept the MCP server connection alive, the Tool Tester still worked but the Chat path sent
  `mcpConfig: undefined` to the LLM, so the model received zero tools (logs showed `Tools: 0` /
  `MCP Server: None`). On startup the UI now rebuilds `this.mcpConfig` (url, transport, headers,
  name, app mode) from the backend-held connection whenever the current server reports
  `isConnected`.

## [0.11.0] - 2026-05-29

Phase 7 — residual MAY-level capabilities + final §18 acceptance. Closes the remaining optional
(MAY) items of the MCP server implementation standard that fall within the SDK's
responsibility (WI-1 … WI-5).
The release is fully additive — new fields are optional and new capabilities are off by default, so
servers that do not use them are unaffected. No `[BREAKING]` or `[BEHAVIOUR]` entries.

### Added

- **`title` / `icons` on prompts** (WI-1, §10.5 MAY). `IPromptData` gains optional `title?: string`
  and `icons?: IIcon[]` (new `IIcon` type: `{ src; mimeType?; sizes? }`, exported from the barrel).
  Built-in prompts now carry a title (`agent_brief` → `Agent brief`, `agent_prompt` → `Agent
  prompt`); declared fields pass through `prompts/list` unchanged. Prompts without them serialize as
  before. The CLI template shows `title` + `icons`.
- **`size` / `icons` on resources** (WI-2, §11.3 MAY). `IResourceInfo` gains optional `size?: number`
  (bytes) and `icons?: IIcon[]` (`title?` existed since Phase 2). Built-in resources get a `title`
  (`doc://readme` → `README`, `project://version` → `Server version`). `resources/list` computes
  `size` from the content (UTF-8 byte length for text/objects, buffer length for blobs); lazy
  (function) content is not measured and simply omits `size`. An author-supplied `size` is preserved.
- **SSE stream resumability (opt-in)** (WI-3, §6 MAY). New `mcp.sse` config block (`resumability`
  default `false`, env `MCP_SSE_RESUMABILITY`; `maxStoredEvents` default `1000`, env
  `MCP_SSE_MAX_STORED_EVENTS`). When enabled, an in-memory `InMemoryEventStore`
  (exported from the barrel) is wired into the Streamable HTTP transport so a
  client reconnecting to `GET /mcp` with a `Last-Event-ID` header replays the events it missed. The
  store is a per-process ring buffer — it does not survive a restart and does not span instances.
  When disabled (default), the transport is created without an event store and behaviour is unchanged.
- **`maskSensitive` helper** (WI-4, §12.2). New helper (exported from the barrel,
  with the `IMaskRules` type) masks personal / sensitive data in tool results by explicit rules:
  field names (case-insensitive) and regular expressions applied at any depth, with a string or
  function replacement (supports partial masking like `4111********1111`). It never mutates the
  input and is **not** wired into the `tools/call` path — applying it and choosing the rules remains
  the server's responsibility, per §12.2. The CLI template shows its use.

### Tests

- New test suites cover prompt/resource metadata (WI-1/WI-2), SSE resumability (WI-3),
  and the `maskSensitive` helper (WI-4).

## Older releases

Earlier entries were split out of this file to keep it readable (progressive disclosure):

- [Versions 0.5.0 – 0.10.0](changelog/CHANGELOG-0.5.0-0.10.0.md) — releases from 2026-05-28 to 2026-05-29.
- [Versions 0.2.265 – 0.4.144](changelog/CHANGELOG-0.2.265-0.4.144.md) — releases up to 2026-05-27.
