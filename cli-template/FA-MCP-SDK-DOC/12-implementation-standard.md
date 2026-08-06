# Corporate MCP Server Implementation Standard

| Parameter              | Value                                                |
|------------------------|------------------------------------------------------|
| Version                | 2.0                                                  |
| Status                 | Active                                               |
| Date                   | 2026-08-05                                           |
| Scope                  | All internal company MCP servers                     |
| Base MCP               | MCP 2026-07-28                                       |
| Form                   | Addendum (corporate profile) over the MCP spec       |
| Starter SDK (optional) | `fa-mcp-sdk`                                         |
| Owner                  | AI/MCP Platform team                                 |

> **Version 2.0 restructures this standard as an ADDENDUM to the official MCP specification `2026-07-28`.**
> The document no longer restates protocol requirements. Everything the specification defines — message format,
> lifecycle, transports, headers, method semantics, error codes, caching, subscriptions, MRTR, extensions — is
> normative **by reference**. This document only (a) adds corporate requirements on top of the specification and
> (b) narrows choices the specification leaves open. If any statement in this document conflicts with the
> specification, the statement is void, the specification wins, and the conflict MUST be reported to the owner
> team. Behavior for legacy protocol revisions (`2025-11-25` and earlier) is collected in
> [Annex D](#annex-d-legacy-compatibility-profile-2025-11-25) and exists only for backward compatibility.

## Table of Contents

1. [Purpose and scope](#1-purpose-and-scope)
2. [Terminology and requirement levels](#2-terminology-and-requirement-levels)
3. [Relationship to the MCP specification](#3-relationship-to-the-mcp-specification)
4. [Server versioning](#4-server-versioning)
5. [Transports](#5-transports)
6. [HTTP interface](#6-http-interface)
7. [Authentication and authorization](#7-authentication-and-authorization)
8. [MCP methods and capabilities](#8-mcp-methods-and-capabilities)
9. [Tools: external contract](#9-tools-external-contract)
10. [Prompts: external contract](#10-prompts-external-contract)
11. [Resources: external contract](#11-resources-external-contract)
12. [Result format](#12-result-format)
13. [Error format](#13-error-format)
14. [Limits and protection](#14-limits-and-protection)
15. [Observability](#15-observability)
16. [Health and readiness](#16-health-and-readiness)
17. [Contract stability and deprecation](#17-contract-stability-and-deprecation)
18. [Compliance checklist](#18-compliance-checklist)
19. [Appendix A. Auth profile](#appendix-a-auth-profile)
20. [Appendix B. Error codes](#appendix-b-error-codes)
21. [Appendix C. Input / output summary table](#appendix-c-input--output-summary-table)
22. [Annex D. Legacy compatibility profile (2025-11-25)](#annex-d-legacy-compatibility-profile-2025-11-25)

---

## 1. Purpose and scope

This document defines the corporate profile of an MCP server developed in-house. It is an addendum over the
common MCP `2026-07-28` protocol and adds internal Avatar / AI Platform requirements for security, network
interface, naming, observability, and operational contracts.

The document covers:

- corporate constraints on transports and the network interface;
- authentication and authorization;
- the set of published tools, prompts, and resources;
- corporate additions to result and error handling;
- operational requirements (health, observability, limits);
- rules for evolving the public contract.

The internal implementation, language, framework, and architecture are **not regulated**. A server may be
built on any technology stack as long as it fully complies with the MCP specification and the external
requirements of this standard. To speed up the start, a team MAY use `fa-mcp-sdk`, the official MCP SDK, or its
own implementation.

The standard applies to servers exposed to:

- internal company AI agents;
- internal services via MCP clients;
- partner environments, if the server is published beyond the perimeter.

The standard **does not apply** to local experimental servers without external consumers.

## 2. Terminology and requirement levels

The RFC 2119 keywords are used:

| Term   | Meaning                                                          |
|--------|------------------------------------------------------------------|
| MUST   | Hard requirement. Non-compliance = acceptance blocker.           |
| SHOULD | Recommended. A deviation requires a justification in the README. |
| MAY    | Allowed at the team's discretion.                                |

Other terms:

- **The specification** — the official MCP specification, revision `2026-07-28`
  (https://modelcontextprotocol.io/specification/2026-07-28).
- **Modern era** — protocol revisions that convey version, identity, and capabilities as per-request `_meta`
  metadata (`2026-07-28` and later).
- **Legacy era** — protocol revisions that establish a session with an `initialize` handshake (`2025-11-25`
  and earlier). See [Annex D](#annex-d-legacy-compatibility-profile-2025-11-25).
- **Dual-era server** — a server that serves both eras, as described by the specification's versioning rules.
- **Public contract** — the set of all externally visible elements of the server, listed in §17.
- **Breaking change** — any change to the public contract that breaks existing clients.
- **Corporate profile** — additional company requirements on top of common MCP. If a requirement is marked as
  corporate, it is not a universal MCP requirement, but it is mandatory for internal servers.

## 3. Relationship to the MCP specification

1. The server MUST fully conform to the MCP specification `2026-07-28`. Protocol conformance is verified
   against the specification text, not against this document.
2. This document intentionally does NOT duplicate the specification. For protocol mechanics consult:

   | Topic                                             | Normative source                                                                 |
   |---------------------------------------------------|----------------------------------------------------------------------------------|
   | Messages, `_meta`, `resultType`, error codes      | `/specification/2026-07-28/basic/index`                                          |
   | Versioning, `server/discover`, extensions, eras   | `/specification/2026-07-28/basic/versioning`, `/specification/2026-07-28/server/discover` |
   | Streamable HTTP, request headers, header mirroring| `/specification/2026-07-28/basic/transports/streamable-http`                     |
   | stdio                                             | `/specification/2026-07-28/basic/transports/stdio`                               |
   | Multi Round-Trip Requests (MRTR)                  | `/specification/2026-07-28/basic/patterns/mrtr`                                  |
   | Subscriptions (`subscriptions/listen`)            | `/specification/2026-07-28/basic/patterns/subscriptions`                         |
   | Caching hints (`ttlMs`, `cacheScope`)             | `/specification/2026-07-28/server/utilities/caching`                             |
   | Tools, prompts, resources                         | `/specification/2026-07-28/server/*`                                             |
   | Authorization framework                           | `/specification/2026-07-28/basic/authorization`                                  |

3. **Dual-era support (corporate).** Internal clients migrate gradually. A new internal server MUST be a
   dual-era server: it serves modern-era clients per the specification and legacy-era internal clients per
   [Annex D](#annex-d-legacy-compatibility-profile-2025-11-25). The legacy era is Deprecated; the corporate
   support window ends no earlier than **2027-07-28** (12 months after the specification release), after which
   legacy support may be dropped in a MAJOR release per §17.
4. Features the specification marks Deprecated (Roots, Sampling, Logging capability, HTTP+SSE transport,
   Dynamic Client Registration) MUST NOT be adopted by new implementations. Existing usage is confined to
   Annex D surfaces.

## 4. Server versioning

The server MUST maintain its own semver versioning:

| Change                                 | Version bump |
|----------------------------------------|--------------|
| Breaking change to the public contract | MAJOR        |
| New tool / prompt / resource           | MINOR        |
| Bugfix without a contract change       | PATCH        |

The server version MUST be available through:

- the `/health` response (the `version` field);
- `_meta["io.modelcontextprotocol/serverInfo"]` of results, including the `server/discover` response;
- the `project://version` resource (SHOULD).

Protocol revisions supported by the server (the `supportedVersions` list of `server/discover`) are part of the
public contract; dropping a revision is a MAJOR change.

## 5. Transports

The server MUST support at least one transport. Allowed transports:

| Transport         | Purpose                                     | When mandatory                                  |
|-------------------|---------------------------------------------|-------------------------------------------------|
| `stdio`           | Local launch (Claude Desktop, etc.)         | if the server targets a desktop agent           |
| `streamable_http` | Corporate network access per the spec       | for all new network MCP servers (MUST)          |
| custom            | Specialized transport                       | MAY with explicit documentation                 |

The semantics of MCP calls MUST be identical across all declared transports. Transport mechanics (framing,
headers, streams, cancellation) follow the specification; this standard adds nothing to them.

The legacy HTTP+SSE transport and session-based Streamable HTTP exist only as Annex D compatibility surfaces.

## 6. HTTP interface

For servers with Streamable HTTP, the corporate endpoint set is:

| Endpoint   | Method | Level  | Purpose                                                     |
|------------|--------|--------|-------------------------------------------------------------|
| `/mcp`     | POST   | MUST   | The MCP endpoint, per the specification                     |
| `/health`  | GET    | MUST   | Liveness check (§16)                                        |
| `/ready`   | GET    | SHOULD | Readiness check (§16)                                       |
| `/`        | GET    | SHOULD | Service HTML page / redirect to documentation               |
| `/metrics` | GET    | MAY    | Prometheus metrics (§15.3)                                  |

Request/response mechanics of `POST /mcp` — including the required `MCP-Protocol-Version`, `Mcp-Method`, and
`Mcp-Name` headers, header-body validation, JSON vs SSE response streams, and status codes — are defined by the
specification and are not restated here. `GET /mcp` and `DELETE /mcp` have no modern-era function; a dual-era
server handles them only as described in Annex D, and a modern-only server answers `405 Method Not Allowed`.

CORS / Origin (corporate):

- the server MUST explicitly configure the list of allowed origins; `*` is forbidden in production;
- preflight OPTIONS MUST be handled correctly;
- `Origin` validation and the HTTP 403 response follow the specification's security requirements;
- local HTTP MCP servers SHOULD bind to `127.0.0.1` rather than `0.0.0.0`.

## 7. Authentication and authorization

### 7.1. General rules

| Requirement                                                     | Level                          |
|-----------------------------------------------------------------|--------------------------------|
| HTTP / Streamable HTTP without authentication                   | FORBIDDEN for internal servers |
| Passing secrets in the query string                             | FORBIDDEN                      |
| Passing secrets in logs / traces                                | FORBIDDEN                      |
| Anonymous access to `server/discover`, `tools/list`, `prompts/list` | MAY (if explicitly decided) |
| Authentication on `tools/call`, `prompts/get`, `resources/read` | MUST                           |

### 7.2. Supported corporate schemes

| Scheme            | Use                                                                | Level        |
|-------------------|--------------------------------------------------------------------|--------------|
| `Bearer` (JWT)    | Primary for service-to-service and user-context                    | MUST support |
| `Bearer` (opaque) | Long-lived server tokens from the secret manager                   | MAY          |
| `Basic`           | Service scenarios and admin endpoints only                         | MAY          |
| Custom            | Only with explicit documentation in the README + `use://http-headers` | MAY      |

Header:

```http
Authorization: Bearer <token>
```

The detailed corporate JWT profile is in [Appendix A](#appendix-a-auth-profile).

### 7.3. Compatibility with OAuth MCP authorization

If the MCP server is published for generic MCP clients and uses authorization, it SHOULD follow the
specification's authorization framework, including:

- the MCP server acts as an OAuth 2.1 resource server and publishes OAuth 2.0 Protected Resource Metadata
  (`/.well-known/oauth-protected-resource`);
- the HTTP 401 response contains `WWW-Authenticate` pointing to the resource metadata;
- the server validates that the access token was issued specifically for this MCP server audience;
- authorization servers SHOULD return the `iss` parameter per RFC 9207, and clients validate it before
  redeeming the authorization code;
- a client performing Dynamic Client Registration specifies an appropriate `application_type`, so an OpenID
  Connect authorization server does not reject its redirect URIs;
- client credentials are bound to the issuing authorization server and MUST NOT be reused across issuers;
- **Client ID Metadata Documents** is the preferred client registration mechanism; Dynamic Client Registration
  is Deprecated and remains only as a fallback for authorization servers without CIMD support;
- token passthrough is forbidden: the MCP server MUST NOT forward downstream the same access token it received
  from the MCP client if the downstream is a separate resource server.

Internal Avatar servers MAY use the corporate JWT / opaque token profile without full OAuth discovery if this
is explicitly stated in the README and `use://auth`.

### 7.4. Authentication responses

| Situation                            | HTTP | Header                                                              |
|--------------------------------------|------|---------------------------------------------------------------------|
| Token missing                        | 401  | `WWW-Authenticate: Bearer realm="<service>"` or an OAuth resource metadata challenge |
| Token invalid / expired              | 401  | `WWW-Authenticate: Bearer error="invalid_token"`                    |
| Token valid, no rights for operation | 403  | —                                                                   |

Authentication errors at the HTTP layer are returned as HTTP 401/403. Standard JSON-RPC codes MUST NOT be
overridden for transport-level auth.

### 7.5. Authorization

The server MUST support at least **boolean authorization** ("allowed / not allowed"). Fine-grained
authorization (per-tool, per-resource) is SHOULD.

If the server uses roles / scopes from a JWT, the list of claims used MUST be documented in
`use://http-headers` or a separate `use://auth` resource.

## 8. MCP methods and capabilities

The lifecycle, `_meta` requirements, `server/discover`, capability semantics, pagination, progress,
cancellation, and subscriptions are defined by the specification. Corporate additions:

1. The server MUST declare only the capabilities it actually supports and MUST NOT require the client to
   support methods outside the client's declared capabilities.
2. `tools` is MUST if the server publishes tools (every internal server publishes at least one tool).
3. `subscriptions/listen` is MAY; if not supported, list results still carry the caching hints required by the
   specification, and clients rely on TTL-based freshness.
4. Long-running and background operations SHOULD use the official Tasks extension
   (`io.modelcontextprotocol/tasks`) rather than ad-hoc job tools. A server that does not support Tasks simply
   does not advertise the extension.
5. An unknown method MUST NOT be silently ignored — the specification's `-32601 Method not found` applies.
6. Custom method names outside the specification and negotiated extensions are FORBIDDEN.

## 9. Tools: external contract

### 9.1. Tool declaration

Each tool in `tools/list` MUST contain `name`, `description`, and `inputSchema` per the specification.
Corporate constraints on top:

| Field         | Level  | Corporate requirement                                                        |
|---------------|--------|------------------------------------------------------------------------------|
| `name`        | MUST   | `^[a-z][a-z0-9_]{1,63}$`, snake_case, English. Stricter than common MCP.     |
| `description` | MUST   | Concise description + constraints + side effects + dangerous actions         |
| `title`       | SHOULD | Human-readable tool name for UI                                              |
| `outputSchema`| SHOULD | If the tool returns `structuredContent`                                      |
| `annotations` | MAY    | Hints to the client (`readOnlyHint`, etc.)                                   |
| `icons`       | MAY    | Icons for UI                                                                 |

### 9.2. `inputSchema` requirements

- JSON Schema 2020-12 is the default dialect (per the specification). If draft-07 is used, `$schema` MUST be
  specified explicitly.
- `inputSchema` MUST be a valid JSON Schema object, not `null`.
- A `$ref` that resolves to a network URI MUST NOT be dereferenced automatically, and composition keywords
  (`anyOf`, `oneOf`, `allOf`, `if`/`then`/`else`, `$defs`) MUST stay within the validator's resource bounds —
  both are specification requirements against schema-driven denial of service. Internal servers SHOULD keep
  schemas self-contained and avoid external references entirely.
- `type: "object"` at the top level — SHOULD;
- explicit `properties` and explicit `required` (even if empty) — SHOULD;
- `additionalProperties: false` — SHOULD;
- a `description` for each field — SHOULD.

Recommended schema for a tool without parameters:

```json
{
  "type": "object",
  "additionalProperties": false
}
```

Parameters mirrored into HTTP headers via `x-mcp-header` MAY be used; when used, the annotations MUST satisfy
the specification's constraints (primitive types, statically reachable properties, header-safe names).

### 9.3. Side effects and risk level

This section is a corporate requirement on top of common MCP.

| Requirement                                                                        | Level  |
|------------------------------------------------------------------------------------|--------|
| A mutating tool MUST explicitly state its side effects in `description`.           | MUST   |
| A mutating tool MUST declare a risk level (for example `low` / `medium` / `high`). | MUST   |
| Domain errors that the model can correct are returned as `result.isError=true`.    | SHOULD |

The risk level MAY be expressed through the standard `annotations` field (`readOnlyHint`, `destructiveHint`,
`idempotentHint`) and MUST additionally be stated in human-readable form in `description` so that a routing
agent can reason about it without parsing annotations.

For tools with external side effects, the following MUST also be documented (in `description`, the README, or
a dedicated resource):

- an idempotency key, or the reason idempotency is absent;
- the retry policy;
- the timeout behavior;
- the audit event emitted by the operation;
- the approval requirement for risky actions.

A read-only tool SHOULD set `readOnlyHint: true` so that clients can treat it as safe to call without
confirmation.

### 9.4. `tools/call` behavior

| Situation                                                    | Response                                                        |
|--------------------------------------------------------------|-----------------------------------------------------------------|
| Malformed JSON-RPC or missing required `_meta` fields        | JSON-RPC error `-32602 Invalid params`                          |
| Unknown `params.name`                                        | JSON-RPC error `-32602` with the safe message `Unknown tool`    |
| `arguments` violate `inputSchema`                            | Tool result `result.isError=true` with actionable diagnostics   |
| Business logic / domain validation error the model can fix   | `result.isError=true` with actionable `content`                 |
| Internal JSON-RPC layer error                                | JSON-RPC error `-32603 Internal error` without a stacktrace     |
| Success                                                      | `result` with `content`, `structuredContent`, or both           |

The server MUST validate `arguments` against `inputSchema` before reaching the domain. A schema violation is
surfaced **to the model** as a tool execution result with `isError: true` (matching the specification's error
model and the reference SDK behavior): the model reads the diagnostic and self-corrects. The diagnostic text
MUST name each violated field and constraint — for example `limit: expected number <= 50; name: required` —
covering up to 8 individual failures, and MUST NOT echo the offending values (§13.3). A deployment MAY disable
SDK-level validation when tools self-validate their arguments.

Errors that relate to the shape of the JSON-RPC request itself (unparseable body, missing required `_meta`
fields, unknown tool name) remain protocol errors per the specification.

### 9.5. Structured output

If a tool declares `outputSchema`, the server MUST return `structuredContent` that conforms to that schema.

`content` and `structuredContent` are independent channels: `content` is the human-/model-readable text that
enters the model context, while `structuredContent` is machine-/UI-oriented data that, per the MCP Apps
specification, MUST NOT be added to the model context. A tool therefore MAY return `structuredContent` alone
with `content` empty, and the server MUST NOT silently serialize `structuredContent` into `content` — a
textual representation for the model, if wanted, MUST be produced explicitly in `content`.

## 10. Prompts: external contract

### 10.1. Prompt support

Prompts are an optional MCP capability. The server MAY publish no prompts. If the server publishes prompts, it
MUST declare the `prompts` capability and implement `prompts/list` and `prompts/get`.

### 10.2. Recommended Avatar profile prompts

For servers that participate in agent routing, the following SHOULD be published:

| Name           | Level  | Purpose                                       |
|----------------|--------|-----------------------------------------------|
| `agent_brief`  | SHOULD | Short description for agent routing (level 1) |
| `agent_prompt` | SHOULD | Full operating instructions (level 2)         |

These prompts are an Avatar-profile corporate recommendation and are not mandatory names of common MCP.

### 10.3. `agent_brief` content

SHOULD describe: the server's domain; when to select this server; when **not** to select it; key constraints
(read-only, data domain, etc.). Size — SHOULD NOT exceed 2 KB of text.

### 10.4. `agent_prompt` content

SHOULD contain: instructions for using each tool; domain and security constraints; the expected format of the
agent's responses; examples (SHOULD).

### 10.5. Parameterized prompts

If a prompt accepts arguments, they MUST be described in `prompts/list` via the standard MCP `arguments`
field. `arguments` is an array of descriptors (`name`, `description`, `required`), not a JSON Schema. Complex
prompt-argument validation rules SHOULD be documented in `description`, the README, or a separate resource.

## 11. Resources: external contract

### 11.1. URI schemes

Two classes of schemes are used.

**1. Service-specific scheme (MUST).** For resources belonging to a specific server, a unique scheme is used
that matches the service name in the registry:

```
<service-name>://<path>
```

Example: `staff://agent/brief`. The server MUST respond only to its own scheme and MUST NOT register others.

**2. Reserved cross-service schemes (standard for the Avatar profile).** This standard reserves the following
global schemes for uniform meta-information; their semantics are fixed and identical across internal servers:

| Scheme       | Purpose                                                  |
|--------------|----------------------------------------------------------|
| `use://`     | Instructions for using the server (headers, auth, etc.)  |
| `project://` | Server meta-information (version, name, owner)           |
| `doc://`     | Server documentation (README, etc.)                      |

The server MUST implement those `use://` / `project://` / `doc://` resources required by §11.2. Inventing your
own paths under these schemes beyond this standard is FORBIDDEN.

### 11.2. Recommended minimum resources

| URI                             | Level                                  | Purpose                                     |
|---------------------------------|----------------------------------------|---------------------------------------------|
| `<service-name>://agent/brief`  | SHOULD                                 | Mirror of the `agent_brief` prompt          |
| `<service-name>://agent/prompt` | SHOULD                                 | Mirror of the `agent_prompt` prompt         |
| `use://http-headers`            | MUST if there are non-standard headers | Description of all expected HTTP headers    |
| `use://auth`                    | SHOULD                                 | Description of the auth scheme and claims   |
| `project://version`             | SHOULD                                 | Current server version                      |
| `doc://readme`                  | MAY                                    | Mirror of the README                        |

### 11.3. Resource definitions and reading

Resource declaration fields (`uri`, `name`, `title`, `description`, `mimeType`, `size`, `icons`), the
`resources/read` result format (`contents[]` with `uri`, `mimeType`, `text` | `blob`), and resource templates
follow the specification.

### 11.4. Resource update notifications

Servers that support change notifications for resources do so via the specification's `subscriptions/listen`
mechanism (opt-in filter, acknowledgment, `io.modelcontextprotocol/subscriptionId` correlation). Per-resource
subscription support is MAY.

## 12. Result format

### 12.1. Allowed tool result formats

A tool result MAY contain one or both formats:

| Format              | When to use                                                            |
|---------------------|------------------------------------------------------------------------|
| `content`           | Human-readable responses, markdown, text, image/audio/resource content |
| `structuredContent` | Machine-readable JSON data with a fixed schema                         |

For a specific tool, the format must be deterministic and documented.

### 12.2. Requirements

- every result carries `resultType` per the specification;
- if the response is truncated by limits, the truncation flag MUST be visible to the client (as text in
  `content` or a field in `structuredContent`);
- personal / sensitive data MUST be protected per the domain policy (masking, filtering);
- binary data is transmitted as `blob` with the correct `mimeType`;
- if `structuredContent` and `outputSchema` are used, the result MUST conform to `outputSchema`;
- `content` and `structuredContent` are independent (§9.5).

### 12.3. Caching hints (corporate defaults)

The specification requires `ttlMs` and `cacheScope` on `server/discover`, `tools/list`, `prompts/list`,
`resources/list`, `resources/templates/list`, and `resources/read` results. Corporate defaults:

- `cacheScope: "private"` unless the result is provably identical for all callers — then `"public"` MAY be
  used; a result that depends on the caller's token MUST be `"private"`;
- catalog listings SHOULD use a `ttlMs` of 60 000 (1 minute) unless the team documents another value;
- `tools/list` SHOULD return tools in a deterministic order (stable sort by `name`) to improve client-side and
  LLM prompt caching.

### 12.4. Multi Round-Trip Requests

Tools that need user confirmation or missing parameters mid-call SHOULD use the specification's MRTR pattern
(`resultType: "input_required"`) instead of failing or inventing custom handshakes. The specification's
`requestState` integrity requirements (HMAC/AEAD protection, principal binding, TTL, request binding) are MUST
whenever `requestState` influences authorization, resource access, or business logic.

## 13. Error format

### 13.1. Protocol errors and tool execution errors

MCP uses two types of errors:

| Type                 | When to use                                                                    | Format                |
|----------------------|--------------------------------------------------------------------------------|-----------------------|
| Protocol error       | Invalid JSON-RPC, unknown method, malformed request, transport/protocol layer  | JSON-RPC error object |
| Tool execution error | The tool was called correctly, but the operation failed or the input can be fixed by the model (including `inputSchema` violations, §9.4) | `result.isError=true` |

### 13.2. Error codes

Protocol-defined codes (including `-32601`, `-32602`, `-32603`, `-32020` HeaderMismatch, `-32021`
MissingRequiredClientCapability, `-32022` UnsupportedProtocolVersion) and the error-code allocation policy are
defined by the specification. Corporate servers additionally use the following implementation-defined codes
from the grandfathered `-32000…-32019` sub-range, with the fixed HTTP mapping:

| Class                | JSON-RPC code | HTTP |
|----------------------|---------------|------|
| Server error         | -32000        | 500  |
| Rate limited         | -32003        | 429  |
| Timeout              | -32004        | 504  |
| Payload too large    | -32005        | 413  |
| Upstream unavailable | -32006        | 503  |
| Conflict             | -32007        | 409  |

"Resource not found" is reported with `-32602 Invalid params` per the specification. The code `-32002` MUST
NOT be emitted in the modern era (it remains only in Annex D for legacy clients). New corporate codes MUST NOT
be allocated in `-32000…-32019`, and the specification-reserved `-32020…-32099` range MUST NOT be used for
corporate codes.

Auth failures at the HTTP layer are returned via HTTP 401/403 and `WWW-Authenticate`, not by overriding the
standard JSON-RPC codes. The full corporate table is in [Appendix B](#appendix-b-error-codes).

### 13.3. Prohibitions

An error returned externally MUST NOT contain:

- a stack trace;
- secrets, tokens, passwords, connection strings;
- internal filesystem paths;
- raw SQL/expression text with user data;
- internal service names that are not part of the public contract.

### 13.4. Mapping upstream (downstream API) errors

This section is a corporate recommendation for servers that proxy a downstream HTTP API (Jira, GitLab, an
internal microservice, etc.). It defines how a failed upstream call is translated into the two error types of
§13.1 so that the model receives an actionable reason instead of one opaque `-32603 Internal error`.

When a tool calls a downstream API, the server SHOULD translate the upstream HTTP status into the matching
typed error class from [Appendix B](#appendix-b-error-codes) rather than collapsing every failure into a
generic internal error. The recommended mapping is:

| Upstream HTTP                 | Typed error class                              | JSON-RPC | Returned to the model |
|-------------------------------|------------------------------------------------|----------|-----------------------|
| 400                           | `ValidationError`                              | -32602   | `isError=true`        |
| 401 / 403                     | `ServerError` (with upstream status in `data`) | -32000   | `isError=true`        |
| 404                           | `ResourceNotFoundError`                        | -32602   | `isError=true`        |
| 409                           | `ConflictError`                                | -32007   | `isError=true`        |
| 429                           | `RateLimitedError`                             | -32003   | thrown (see below)    |
| 502 / 503 / 504 / no response | `UpstreamUnavailableError`                     | -32006   | `isError=true`        |
| other 5xx                     | `ServerError`                                  | -32000   | thrown                |

The decision whether to surface an error to the model or to throw it follows three rules:

- An error whose message is **safe to expose and actionable** — built from the structured upstream error body,
  not from internal state — SHOULD be returned as a tool execution result with `result.isError=true` (§9.4,
  §13.1). The model reads the upstream reason (for example `Issue AITECH-123 does not exist`) and
  self-corrects instead of treating the call as a hard sandbox failure. A `404` raised by the downstream API
  is the canonical case: it MUST reach the model as `result.isError=true`, not as a thrown protocol error.
- `-32003 Rate limited` MUST remain a **thrown** protocol error and MUST carry the `Retry-After` header /
  `retryAfter` value (§14, Appendix B.3). It MUST NOT be flattened into an `isError` text result, because
  clients rely on the numeric code and the retry hint to schedule a retry.
- An internal failure with **no upstream status** (the catch-all wrapper around an unexpected exception) MUST
  stay a thrown protocol error and MUST be sanitized per §13.3 — typically `-32603 Internal error` with no
  stack trace and no secrets.

A reference implementation of this pattern — a pure `normalizeToolError()` that converts any thrown value into
a typed error without throwing, an `isLlmVisibleError()` predicate that applies the three rules above, and the
`formatToolError()` call that surfaces the message — is documented in
[02-1-tools-and-api.md → "Normalizing upstream API errors"](./02-1-tools-and-api.md).

Whatever message is exposed (via `isError=true` or a thrown error) MUST still satisfy the §13.3 prohibitions:
the upstream error body is forwarded only after it has been reduced to its human-readable text, never as a raw
payload that could carry internal paths, tokens, or stack traces.

## 14. Limits and protection

Each server MUST document and enforce:

| Limit                          | Default         | Level  |
|--------------------------------|-----------------|--------|
| Input payload size             | 1 MB            | MUST   |
| Tool result size               | 10 MB           | MUST   |
| Tool call timeout              | 30 seconds      | MUST   |
| Rate limit per token           | service-defined | SHOULD |
| Max concurrent calls per token | service-defined | SHOULD |

On exceeding a limit:

- payload too large → `-32005` / HTTP 413;
- result too large → truncation with an explicit flag;
- timeout → `-32004` / HTTP 504;
- rate limit → `-32003` / HTTP 429 with the `Retry-After` header.

## 15. Observability

### 15.1. Correlation

For servers with the HTTP / Streamable HTTP transport, the server MUST support propagating identifiers:

| Source                                       | Level  | Behavior                                            |
|----------------------------------------------|--------|-----------------------------------------------------|
| `X-Request-Id` header                        | MUST   | Accept; generate if absent; return in the response  |
| `traceparent` / `tracestate` headers         | SHOULD | Accept the W3C trace context                        |
| `traceparent` / `tracestate` / `baggage` in `_meta` | SHOULD | Accept per the specification's OpenTelemetry conventions |

For the stdio transport, the server MUST generate its own request id per JSON-RPC call and use it in logs for
correlation.

### 15.2. Logging

The server MUST log:

- the fact of a tool call: name, request id, duration, status (ok / error class);
- auth-failure facts: reason, request id;
- internal errors with full context — **only to internal logs**, never externally.

The server MUST NOT log:

- `arguments` values containing personal data, without masking;
- tokens, passwords, `Authorization` headers.

Protocol-level log delivery to the client follows the specification (`_meta.io.modelcontextprotocol/logLevel`,
request-scoped `notifications/message`). Server-side operational logging goes to `stderr` / infrastructure
logs / OpenTelemetry, per the specification's recommendations.

### 15.3. Metrics

SHOULD expose: a call counter by tool and status; a call-duration histogram; an auth-failures counter; a
rate-limit events counter.

## 16. Health and readiness

### 16.1. `/health` (liveness)

| Property       | Requirement                   |
|----------------|-------------------------------|
| Method         | GET                           |
| Authentication | NOT required                  |
| Body           | JSON                          |
| HTTP 200       | service is alive              |
| HTTP 503       | service cannot serve requests |

Minimal body:

```json
{
  "status": "ok",
  "version": "1.2.3",
  "uptime": 3600
}
```

### 16.2. `/ready` (readiness)

SHOULD. Returns 200 only when the server is ready to accept `tools/call` (including dependency readiness: DB,
secret store, JWKS).

```json
{
  "status": "ready",
  "checks": {
    "db": "ok",
    "jwks": "ok"
  }
}
```

### 16.3. Prohibitions

The `/health` and `/ready` responses MUST NOT include: secrets; connection strings; full dependency error
messages (status only).

## 17. Contract stability and deprecation

### 17.1. What is part of the public contract

| Element                                   | Stability          |
|-------------------------------------------|--------------------|
| Supported transports                      | MAJOR              |
| Supported protocol revisions (`supportedVersions`) | MAJOR     |
| HTTP endpoints (`/mcp`, `/health`)        | MAJOR              |
| Authentication scheme                     | MAJOR              |
| List of tools (names)                     | MAJOR              |
| Tool `inputSchema` (required fields)      | MAJOR              |
| Tool `outputSchema`                       | MAJOR if published |
| Result format of each tool                | MAJOR              |
| Prompt names                              | MAJOR              |
| URI scheme and base resources             | MAJOR              |
| Error codes                               | MAJOR              |
| Adding a new tool / prompt / resource     | MINOR              |
| Adding an optional field                  | MINOR              |
| Extending a `description`                 | PATCH              |

### 17.2. Deprecation process

1. The `description` of the tool/prompt/resource gets a `[DEPRECATED]` prefix and a support deadline.
2. It is announced in the server's CHANGELOG.
3. The minimum period before removal is **2 MINOR versions** or **3 months**, whichever is longer.
4. Known consumers are notified (via the owner team).
5. After the deadline, removal happens in the next MAJOR.

Dropping the legacy era (Annex D) follows the same process, with the corporate window of §3.3 as the minimum.

### 17.3. CHANGELOG

The server MUST maintain a `CHANGELOG.md` in the Keep a Changelog format.

## 18. Compliance checklist

Minimal acceptance checklist. All MUST items are mandatory to pass review.

### Specification conformance

- [ ] the server conforms to MCP `2026-07-28` (verified against the specification, including `_meta` handling,
      `server/discover`, request headers, `resultType`, caching hints, and error codes)
- [ ] `server/discover` returns correct `supportedVersions` and capabilities for every configuration
- [ ] required request headers (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) are validated against the body
- [ ] an unknown method → `-32601`; unsupported protocol version → `-32022` with the `supported` list
- [ ] every result carries `resultType`; catalog and read results carry `ttlMs` and `cacheScope`
- [ ] legacy internal clients are served per Annex D (dual-era), or the server is explicitly modern-only with
      the deviation justified in the README

### Transport and HTTP

- [ ] at least one transport from {stdio, streamable_http} is supported
- [ ] `GET /health` is implemented for HTTP
- [ ] CORS is configured explicitly, without `*` in production; invalid `Origin` → 403
- [ ] the maximum payload size is documented

### Authentication

- [ ] HTTP / Streamable HTTP requires authentication on `tools/call`
- [ ] `Authorization: Bearer <token>` is supported
- [ ] JWT is validated by issuer / audience / exp (see Appendix A)
- [ ] 401 contains a correct `WWW-Authenticate`
- [ ] for generic MCP clients, OAuth discovery is described, or the server is explicitly marked internal-only
- [ ] token passthrough is forbidden
- [ ] secrets are not passed in the query / logs

### Tools

- [ ] all tools have `name`, `description`, `inputSchema`
- [ ] names are snake_case and English
- [ ] `inputSchema` is JSON Schema 2020-12 (or explicitly specifies `$schema`)
- [ ] `arguments` are validated; schema violations reach the model as `result.isError=true` with field-level
      diagnostics
- [ ] mutating tools state their side effects and risk level
- [ ] tools with external side effects document idempotency, retry, timeout, audit, and approval
- [ ] the result format is deterministic; `tools/list` order is deterministic

### Prompts and resources

- [ ] prompts are declared only if the `prompts` capability exists
- [ ] if the server participates in agent routing, `agent_brief` and `agent_prompt` are published, or the
      deviation is explained in the README
- [ ] prompt arguments are described via the standard MCP `arguments[]`, not as an `inputSchema`
- [ ] if there are non-standard headers, `use://http-headers` is published
- [ ] URIs use scheme = service name or the corporate schemes `use://`, `project://`, `doc://`

### Errors and limits

- [ ] protocol errors are returned in the JSON-RPC format; tool/domain errors via `isError=true`
- [ ] error codes match Appendix B; `-32002` is not emitted in the modern era
- [ ] timeout, rate limit, payload limit are implemented and documented
- [ ] errors do not contain a stacktrace or secrets

### Observability

- [ ] `X-Request-Id` is supported
- [ ] `traceparent` is accepted (header and `_meta`) if the W3C trace context is used
- [ ] there is structured logging of calls; logs do not contain tokens and PII without masking

### Documentation and contract

- [ ] there is a README describing the public contract
- [ ] there is a CHANGELOG.md
- [ ] semver is followed
- [ ] the version is available in `/health` and `_meta["io.modelcontextprotocol/serverInfo"]`
- [ ] the `project://version` resource is implemented, or it is explicitly acknowledged as optional

---

## Appendix A. Auth profile

### A.1. JWT — the mandatory profile for internal servers

| Parameter          | Requirement                                     |
|--------------------|-------------------------------------------------|
| Signing algorithm  | RS256 or ES256 (HS256 — local development only) |
| Key source         | Corporate JWKS endpoint                         |
| JWKS cache         | TTL ≤ 10 minutes                                |
| `exp` validation   | MUST                                            |
| `nbf` validation   | MUST if present                                 |
| `iss` validation   | MUST, value from config                         |
| `aud` validation   | MUST, value = server identifier                 |
| Allowed clock skew | ≤ 60 seconds                                    |

### A.2. Minimal set of claims

| Claim   | Type   | Purpose                                  |
|---------|--------|------------------------------------------|
| `iss`   | string | Issuer (corporate IdP)                   |
| `aud`   | string | Target server identifier                 |
| `sub`   | string | Subject identifier (user / service)      |
| `exp`   | number | Expiration                               |
| `iat`   | number | Issued-at time                           |
| `scope` | string | Space-separated list of scopes (if used) |

### A.3. Opaque tokens

Allowed only if: stored in the corporate secret store; rotated per company policy; verified via an
introspection endpoint or a built-in whitelist.

### A.4. Basic Auth

HTTPS only; admin/service endpoints only; credentials taken from the secret store, not from code.

### A.5. Header examples

```http
POST /mcp HTTP/1.1
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_weather
X-Request-Id: 6f1c4f0e-2b7a-4f3e-8b7e-1a9b5c2d3e4f
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
```

---

## Appendix B. Error codes

### B.1. JSON-RPC and specification codes

Defined by JSON-RPC 2.0 and the MCP specification; listed here for the corporate HTTP mapping only:

| Code   | Name                            | HTTP | When                                                    |
|--------|---------------------------------|------|---------------------------------------------------------|
| -32700 | Parse error                     | 400  | Invalid JSON                                            |
| -32600 | Invalid Request                 | 400  | Does not conform to JSON-RPC                            |
| -32601 | Method not found                | 404  | Unknown MCP method                                      |
| -32602 | Invalid params                  | 400  | Malformed request, missing `_meta`, unknown tool name, resource not found |
| -32603 | Internal error                  | 500  | Internal error of the JSON-RPC layer                    |
| -32020 | HeaderMismatch                  | 400  | Request headers missing or not matching the body        |
| -32021 | MissingRequiredClientCapability | 400  | Client did not declare a capability the request needs   |
| -32022 | UnsupportedProtocolVersion      | 400  | Requested protocol version not supported                |

### B.2. Corporate server codes (grandfathered range -32000…-32019)

| Code   | Name                 | HTTP | When                                                |
|--------|----------------------|------|-----------------------------------------------------|
| -32000 | Server error         | 500  | Internal server error not related to tool execution |
| -32003 | Rate limited         | 429  | Rate limit exceeded; include `Retry-After`          |
| -32004 | Timeout              | 504  | Call timeout exceeded                               |
| -32005 | Payload too large    | 413  | Size limit exceeded                                 |
| -32006 | Upstream unavailable | 503  | A dependency is unavailable (DB, etc.)              |
| -32007 | Conflict             | 409  | State conflict (if applicable)                      |

`-32002 Resource not found` is legacy-only (Annex D): it MUST NOT be emitted in the modern era, but MAY still
be accepted from servers implementing earlier protocol revisions. New corporate codes MUST NOT be allocated in
`-32000…-32019` and MUST NOT use the specification-reserved `-32020…-32099` range.

### B.3. `error.data` structure

`error.data` SHOULD contain the fields:

| Field        | Type   | Purpose                                                       |
|--------------|--------|---------------------------------------------------------------|
| `requestId`  | string | Request correlation id                                        |
| `field`      | string | Field name for validation errors                              |
| `reason`     | string | Machine-readable reason (`required`, `format`, `range`, etc.) |
| `retryAfter` | number | Seconds until retry (for -32003)                              |

### B.4. Forbidden content

In `message` and `data`, the following is FORBIDDEN: stack traces; internal paths; secrets of any kind; raw
user input text with potential PII.

---

## Appendix C. Input / output summary table

### C.1. What the server accepts

| Source                  | What                                                    | Level                              |
|-------------------------|---------------------------------------------------------|------------------------------------|
| Transport               | stdio / streamable_http                                 | at least one MUST                  |
| HTTP                    | `POST /mcp`, `GET /health`                              | MUST for a streamable_http server  |
| Header                  | `Authorization: Bearer <token>`                         | MUST for HTTP / Streamable HTTP    |
| Header                  | `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`        | per the specification              |
| Header                  | `Accept: application/json, text/event-stream`           | per the specification              |
| Header                  | `X-Request-Id`                                          | MUST accept                        |
| Header                  | `traceparent`                                           | SHOULD                             |
| `_meta`                 | `io.modelcontextprotocol/protocolVersion`, `…/clientCapabilities`, `…/clientInfo`, `…/logLevel` | per the specification |
| MCP method              | `server/discover`                                       | MUST                               |
| MCP method              | `tools/list`, `tools/call`                              | MUST if the `tools` capability     |
| MCP method              | `prompts/list`, `prompts/get`                           | MUST if the `prompts` capability   |
| MCP method              | `resources/list`, `resources/read`                      | MUST if the `resources` capability |
| MCP method              | `resources/templates/list`                              | MAY                                |
| MCP method              | `subscriptions/listen`                                  | MAY                                |
| MCP methods             | `tasks/get`, `tasks/update`, `tasks/cancel`             | MAY, only with the Tasks extension |
| MCP notification        | `notifications/cancelled` (stdio)                       | per the specification              |
| `tools/call.params`     | `name`, `arguments`, `_meta`, MRTR retry fields         | MUST                               |
| `prompts/get.params`    | `name`, `arguments?`, `_meta`                           | MUST                               |
| `resources/read.params` | `uri`, `_meta`                                          | MUST                               |

### C.2. What the server returns

| Where                      | What                                                                  | Level                   |
|----------------------------|-----------------------------------------------------------------------|-------------------------|
| every result               | `resultType`; `_meta["io.modelcontextprotocol/serverInfo"]` (SHOULD)  | per the specification   |
| `server/discover.result`   | `supportedVersions`, `capabilities`, `instructions?`, caching hints   | MUST                    |
| `tools/list.result`        | tools with `name`, `description`, `inputSchema`; deterministic order; caching hints | MUST if tools |
| `tools/call.result`        | `content` / `structuredContent`, `isError?`, or MRTR `input_required` | MUST if tools           |
| `prompts/*`, `resources/*` | per the specification, with caching hints on list/read results        | MUST if declared        |
| `GET /health`              | JSON with `status`, `version`, `uptime`                               | MUST for HTTP           |
| `GET /ready`               | JSON with `status`, `checks`                                          | SHOULD                  |
| Response header            | `X-Request-Id`                                                        | MUST                    |
| Response header (401)      | `WWW-Authenticate: Bearer ...` or an OAuth resource metadata challenge| MUST                    |
| Response header (429)      | `Retry-After`                                                         | MUST                    |
| Protocol error             | JSON-RPC error object without secrets and stacktraces                 | MUST                    |
| Tool execution error       | `result.isError=true`                                                 | MUST for tool/domain errors |

### C.3. What the server MUST NOT return externally

- stack traces;
- secrets, tokens, passwords, connection strings;
- internal paths and service names;
- raw SQL / DSL queries with user data;
- personal data beyond what the domain allows.

---

## Annex D. Legacy compatibility profile (2025-11-25)

**Status: Deprecated.** This annex applies ONLY when serving clients that speak protocol revisions
`2025-11-25` and earlier. Nothing in it may be exposed to modern-era clients, and no new features may be added
to legacy-only surfaces. The corporate support window ends no earlier than **2027-07-28** (§3.3); removal is a
MAJOR change (§17).

When serving a legacy client, the server follows the corresponding legacy specification revision
(https://modelcontextprotocol.io/specification/2025-11-25), including:

1. **Lifecycle.** The `initialize` → `initialize.result` → `notifications/initialized` handshake; capabilities
   and `serverInfo` are exchanged once per session; `ping` is accepted.
2. **Era selection.** Per the `2026-07-28` versioning rules, an `initialize` request selects legacy semantics;
   a request carrying modern per-request `_meta` is served statelessly. A dual-era server MAY serve both eras
   concurrently on the same endpoint.
3. **Sessions.** The server MAY issue `MCP-Session-Id` on `initialize`; the session id MUST be globally
   unique, cryptographically strong, visible-ASCII only, and MUST NOT be used as proof of identity. Requests
   without a required session id → HTTP 400; expired session → HTTP 404. `GET /mcp` MAY serve the standalone
   SSE stream; `DELETE /mcp` MAY terminate the session. The `MCP-Protocol-Version` header is sent on
   subsequent requests after negotiation.
4. **Legacy methods.** `resources/subscribe` / `resources/unsubscribe` and `notifications/resources/*` per the
   legacy revision; the `logging` capability and `logging/setLevel`; task-augmented execution per the legacy
   experimental `tasks` capability, if the server declared it.
5. **Legacy error codes.** `-32002 Resource not found` is used toward legacy clients where the legacy revision
   prescribes it.
6. **HTTP+SSE transport (2024-11-05).** A separate `GET /sse` + `POST /messages` endpoint pair MAY be kept
   only for existing legacy consumers. It is Deprecated; new consumers MUST NOT be onboarded to it.
7. **Validation diagnostics (legacy corporate profile).** Toward legacy internal clients the server MAY keep
   returning `inputSchema` violations as `-32602` protocol errors with `error.data` per Appendix B.3, since
   existing internal clients depend on that behavior. Toward modern clients §9.4 applies.

The dual-era detection mechanics (probing, fallback, era caching) are defined by the `2026-07-28`
specification's versioning and transport pages and are not restated here.
