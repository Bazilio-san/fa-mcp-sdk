# Test Registry

The SDK has no Jest setup. Automated suites run on **Node's built-in flow** (`assert` + direct
execution) from `tests/*.test.mjs`; a few MCP transport checks stay **manual integration scripts**
run against a live server.

Every suite runs against the compiled output, so build first:

```bash
npm run build
node tests/<name>.test.mjs                       # one suite
for f in tests/*.test.mjs; do node "$f"; done    # everything
```

## Protocol eras under test

The server serves two protocol eras on the same endpoint, and the suites are split accordingly:

- **modern** — MCP revision `2026-07-28`: stateless, no `initialize`, no sessions, a per-request
  `_meta` envelope plus the `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers;
- **legacy** — `2025-11-25` and earlier: the `initialize` handshake with `Mcp-Session-Id` sessions.

`tests/dual-era.test.mjs` drives BOTH at once, with the official reference client of each
generation, and asserts they do not interfere.

## Automated suites — modern era (MCP 2026-07-28)

| File | Covers |
| ---- | ------ |
| `tests/modern-discover.test.mjs` | `server/discover` (supported versions, capabilities, `serverInfo`, cache hints), catalog and tool call with `resultType`, schema violation as `isError`, legacy regression on the same server |
| `tests/modern-headers.test.mjs` | Request-header contract: `Mcp-Name`/`Mcp-Method` against the body (`-32020`), unsupported version (`-32022`), the Base64 sentinel encoding |
| `tests/modern-meta.test.mjs` | `_meta` envelope validation (`-32602` when absent or incomplete), unknown method → `-32601` + HTTP 404, notification → HTTP 202 |
| `tests/modern-cache-hints.test.mjs` | `ttlMs` / `cacheScope` from `mcp.cacheHints` on every cacheable result, deterministic `tools/list` order, prompts and resources through the shared catalog core, `-32602` for an unknown resource |
| `tests/modern-subscriptions.test.mjs` | `subscriptions/listen`: acknowledgment first, `subscriptionId` correlation, delivery of the opted-in types only |
| `tests/modern-mrtr.test.mjs` | Multi round-trip requests: `input_required` → retry → completion, tampered `requestState` rejected, missing client capability degraded to `isError` |
| `tests/modern-tasks.test.mjs` | Tasks extension: advertisement, `CreateTaskResult`, polling, mid-flight input via `tasks/update`, cancellation, synchronous fallback without the extension |
| `tests/modern-observability.test.mjs` | `notifications/progress` gated by `progressToken`; `notifications/message` filtered by the request's own `logLevel` (absent ⇒ silence) |
| `tests/modern-stdio.test.mjs` | Dual-era stdio: a modern opening selects the v2 path, an `initialize` opening keeps the legacy one |
| `tests/template-examples.test.mjs` | The template's `example_confirm` (MRTR) and the `x-mcp-header` mirroring on `example_search` |

## Automated suites — transport contract and cross-era

| File | Covers |
| ---- | ------ |
| `tests/dual-era.test.mjs` | Both official reference clients against one endpoint, interleaved; session round-trip, stale session → HTTP 404, notification → 202, `GET`/`DELETE /mcp` |
| `tests/capabilities.test.mjs` | Conditional capability advertisement (in-memory transport) |
| `tests/sse-resumability.test.mjs` | Legacy SSE stream resumability (`Last-Event-ID`) |

## Automated suites — server behaviour

| File | Covers |
| ---- | ------ |
| `tests/error-codes.test.mjs` | Typed error classes `-32006` / `-32007` and the DB error mapping |
| `tests/scope-error.test.mjs` | Insufficient scope → `-32000` with `data.reason` (`-32004` is Timeout only) |
| `tests/error-sanitize.test.mjs` | Outward error sanitisation (no stack traces, no internal paths) |
| `tests/request-id.test.mjs` | `X-Request-Id` middleware and the W3C trace context from headers and from `_meta` |
| `tests/metrics.test.mjs` | Prometheus endpoint on and off |
| `tests/deprecation.test.mjs` | `[DEPRECATED]` decoration and call-time warnings |
| `tests/completions.test.mjs` | `completion/complete` capability and result cap |
| `tests/binary-resource.test.mjs` | Binary resource `blob` encoding |
| `tests/prompt-resource-metadata.test.mjs` | Prompt and resource metadata fields |
| `tests/mask-sensitive.test.mjs` | `maskSensitive` helper |
| `tests/tasks-lifecycle.test.mjs`, `tasks-cancel`, `tasks-progress`, `tasks-capability` | Legacy-era task lifecycle |

## Automated suites — auth

| File | Covers |
| ---- | ------ |
| `tests/jwt.test.mjs` | Signed JWT generate/verify, expiry, tamper, audience, revocation, legacy tokens (`npm run test:jwt`) |
| `tests/jwt-v2.test.mjs` | jose-based verification paths |
| `tests/ip-check.test.mjs` | `parseIpList`, CIDR `isIpAllowed`, IP-restricted JWT (`npm run test:ip-check`) |
| `tests/oauth-endpoints.test.mjs` | OAuth discovery endpoints and `WWW-Authenticate` |
| `tests/agent-tester-auth-modes.test.mjs`, `agent-tester-ttl-refresh.test.mjs` | Agent Tester session auth |

## Helpers

| File | Purpose |
| ---- | ------- |
| `tests/helpers/spawn-server.mjs` | Boots the template server in a subprocess with a config override |
| `tests/helpers/modern-rpc.mjs` | Raw modern JSON-RPC calls (envelope + required headers) for wire-level assertions |

## Manual integration scripts

Run against a server that is already up (`npm run build && npm start`; port from
`config/default.yaml` → `webServer.port`, default 9876):

| File | Era | Covers |
| ---- | --- | ------ |
| `src/tests/mcp/test-http-modern.js` | modern | `server/discover` plus prompts, resources and tools through `McpModernHttpClient` (the official reference client) |
| `src/tests/mcp/test-http.js` | legacy | Handshake, prompts, resources, tools, auth headers via `McpHttpClient` |
| `src/tests/mcp/test-sse.js` | legacy | Deprecated HTTP+SSE transport (`GET /sse` + `POST /messages`) |
| `src/tests/mcp/test-stdio.js` | legacy | STDIO with a minimal in-file NDJSON client (spawns the server itself) |
| `src/tests/mcp/test-cases.js` | — | Shared prompt/resource/tool assertions used by the scripts above |
| `src/tests/mcp/sse/test-sse-npm-package.js` | legacy | Using `fa-mcp-sdk` as an npm package over SSE |
| `src/tests/utils.ts` | — | Shared test utilities |
