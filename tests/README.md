# Test Registry

The SDK has no Jest setup. Tests run on **Node's built-in flow** (`assert` + direct execution); MCP
transport suites are **manual integration scripts** run against a live server.

## Test files

| File | Kind | Runner | Needs live server | Covers |
| ---- | ---- | ------ | ----------------- | ------ |
| `tests/jwt.test.mjs` | unit/integration | `npm run test:jwt` (build + node) | no (spawns `generate-jwt`) | Standard signed JWT generate/verify, expiry, tamper, audience, revoke (jti/exact), legacy tokens, bearer auth-detection |
| `tests/ip-check.test.mjs` | unit | `npm run test:ip-check` (build + node) | no | `parseIpList`, CIDR `isIpAllowed`, IP-restricted JWT allow/deny |
| `tests/compliance-hardening.test.mjs` | unit/in-memory integration | `npm run test:compliance-hardening` | no | Exact tool names, hidden aliases, fail-closed schemas, result size, CORS, protected reads, scope discovery/dispatch |
| `tests/auth-list-protection.test.mjs` | unit | included in `npm run test:compliance-hardening` | no | Unauthenticated catalog lists rejected when HTTP auth is enabled |
| `src/tests/mcp/test-cases.js` | shared fixtures | imported by the 3 below | — | Prompt/resource/tool assertions (happy + error path) for the template server |
| `src/tests/mcp/test-http.js` | integration | `node src/tests/mcp/test-http.js` | **yes** (`npm start`) | HTTP via `McpHttpClient` → now **Streamable HTTP** (deprecated alias). `initialize` handshake, prompts, resources, tools, auth headers |
| `src/tests/mcp/test-sse.js` | integration | `MCP_LEGACY_SSE_ENABLED=true node src/tests/mcp/test-sse.js` | **yes** | Opt-in legacy SSE migration transport using canonical policy |
| `src/tests/mcp/test-stdio.js` | integration | `node src/tests/mcp/test-stdio.js` | spawns stdio server | STDIO transport via a minimal in-file NDJSON client |
| `src/tests/mcp/sse/test-sse-npm-package.js` | example | `node …` | yes | Using `fa-mcp-sdk` as an npm package over SSE without unhandledRejection issues |
| `src/tests/utils.ts` | helper | — | — | Shared test utilities |
| `src/tests/jest-simple-reporter.js` | infra | — | — | Reporter stub (no active Jest run) |

Run order for integration suites: `npm run build && npm start` (port from `config/default.yaml` →
`webServer.port`, default 9876), then run the `node src/tests/mcp/test-*.js` script in another shell.

## Coverage gap vs. Phase 0.3 (Streamable HTTP transport swap)

The transport rewrite (hand-rolled `switch` → SDK `StreamableHTTPServerTransport`, stateful sessions,
`2025-11-25` negotiation, `GET`/`DELETE /mcp`, `req.auth` bridge) is exercised **only** by the happy
path of `test-http.js` (manual, live server). The following behaviours have **no committed automated
test** — they were verified manually via `curl` during implementation:

| Behaviour | Verified | Automated test |
| --------- | -------- | -------------- |
| `initialize` echoes negotiated `protocolVersion: 2025-11-25` | manual curl ✅ | ❌ missing |
| Unsupported protocol version → handled, not crash | — | ❌ missing |
| `Mcp-Session-Id` issued + round-trip on subsequent calls | implicit via client ✅ | ❌ no explicit assert |
| `notifications/*` → HTTP **202** | manual curl ✅ | ❌ missing |
| `GET /mcp` (SSE stream) and `DELETE /mcp` (session teardown) | manual curl ✅ (DELETE→200) | ❌ missing |
| POST without session and not `initialize` → **400** | manual curl ✅ | ❌ missing |
| Session eviction at `MAX_HTTP_SESSIONS` cap | — | ❌ missing |
| `req.auth` payload reaches handler as `params.payload.user` | indirect | ❌ no explicit assert |
| `McpHttpClient` alias still connects (Streamable HTTP) | `test-http.js` ✅ | ✅ (happy path) |

**Recommendation:** add a transport-conformance suite (`tests/mcp-transport.test.mjs`) that boots the
server once and asserts the status-code / header / negotiation contract above — turning the manual
curl checks into a repeatable gate. Not yet written.
