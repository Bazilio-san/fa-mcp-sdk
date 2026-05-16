---
name: update-mcp-apps-spec
description: Regenerate the cli-template/FA-MCP-SDK-DOC/10-mcp-apps.md MCP Apps spec digest from the upstream modelcontextprotocol/ext-apps repository (latest released tag of @modelcontextprotocol/ext-apps). Use when the user asks to "update MCP apps doc", "refresh MCP apps spec", "regenerate 10-mcp-apps.md", or notes that the MCP Apps specification has changed upstream.
---

# Update MCP Apps Spec Digest

Pull the upstream MCP Apps protocol + SDK material from `modelcontextprotocol/ext-apps` and rewrite
`cli-template/FA-MCP-SDK-DOC/10-mcp-apps.md` so it stays a single self-contained digest of MCP Apps
that an LLM can read end-to-end without going back to the repo for routine work. The repo is
consulted only as the reference point for source-of-truth lookups.

This skill produces a digest only. It does NOT change `src/core/**` or any runtime code in
`fa-mcp-sdk`, and it does NOT scaffold new servers or wire UI into existing tools — if the user
asks for code changes of that kind, decline and let them invoke the appropriate scaffolding flow
themselves.

## What This Skill Produces

| Path | Action |
|------|--------|
| `cli-template/FA-MCP-SDK-DOC/10-mcp-apps.md` | Rewrite (create on first run) — the digest |
| `cli-template/FA-MCP-SDK-DOC/00-FA-MCP-SDK-index.md` | Edit — add/refresh the entry for 10-mcp-apps.md |
| `cli-template/CLAUDE.md` | Edit — add/refresh the row for 10-mcp-apps.md in the "Framework Documentation" table |

Nothing else is touched. The digest's header records the pinned ext-apps tag and the spec date so
future runs can detect drift.

## Step 1: Pin and Clone Upstream

Pin to the latest released version of `@modelcontextprotocol/ext-apps` and clone the matching tag
into a temp dir **outside** the repo so it is never accidentally committed:

```bash
# Resolve the latest published tag
EXT_APPS_VERSION="$(npm view @modelcontextprotocol/ext-apps version)"

# Clone the matching tag into a sibling temp dir (NOT inside this repo)
TMP_DIR="$(mktemp -d)/mcp-ext-apps"
git clone --branch "v${EXT_APPS_VERSION}" --depth 1 \
  https://github.com/modelcontextprotocol/ext-apps.git "${TMP_DIR}"

# Record the commit SHA for the digest header
EXT_APPS_SHA="$(git -C "${TMP_DIR}" rev-parse --short HEAD)"
```

If `npm view` fails (offline / registry hiccup), fall back to the default branch but record `(HEAD)`
instead of a version tag in the digest header.

> Note for Windows: `mktemp -d` works under git-bash / WSL. Under cmd, use `%TEMP%\mcp-ext-apps`.

## Step 2: Read the Source Material

Read everything below from the cloned repo. Treat the spec file as normative; everything else
illustrates it. **Do not skim.** The digest's accuracy depends on the LLM having actually read
each file in full.

### Normative — protocol contract

| File | What it owns |
|------|--------------|
| `specification/2026-01-26/apps.mdx` | SEP-1865 (Stable) — `ui://` URI scheme, `_meta.ui` contract on tool/resource/content, capability negotiation, all host↔UI JSON-RPC messages, iframe sandboxing, CSP semantics, security model. Contains the normative **Lifecycle** section with four mermaid sequence diagrams (Connection & Discovery, UI Initialization, Interactive Phase, Cleanup) that define the canonical message order — these MUST be copied into the digest verbatim, not paraphrased |
| `specification/draft/` (if present) | Pre-stable changes — note in the digest header if a new draft exists, but the digest body documents the stable version |

### Reference docs (high signal)

| File | What it adds |
|------|--------------|
| `docs/overview.md` | Top-level architecture, terminology |
| `docs/quickstart.md` | Concrete server + UI skeleton; idiomatic minimal example |
| `docs/patterns.md` | Authoritative pattern catalog (app-only tools, polling, chunked, view state, model context, fullscreen, streaming input, visibility pause, etc.) |
| `docs/csp-cors.md` | When/how to declare `_meta.ui.csp` and `_meta.ui.domain`, where they go (`contents[]`, not the resource config) |
| `docs/authorization.md` | Auth/OAuth flow specific to apps |
| `docs/testing-mcp-apps.md` | `basic-host` workflow, `sendLog`, debugging tips |
| `docs/migrate_from_openai_apps.md` | Migration notes — read once to flag deprecated patterns, but do not include in the digest |

### TypeScript SDK surface (source of truth for "how")

| File | What it exposes |
|------|----------------|
| `src/app.ts` | `App` class, all handlers (`ontoolinput`, `ontoolinputpartial`, `ontoolresult`, `onhostcontextchanged`, `onteardown`, etc.), `app.connect`, `app.requestDisplayMode`, `app.callServerTool`, `app.sendLog`, `app.sendMessage`, `app.updateModelContext` |
| `src/server/index.ts` | `registerAppTool`, `registerAppResource`, `getUiCapability`, `RESOURCE_MIME_TYPE`, visibility options |
| `src/spec.types.ts` | `McpUiHostContext`, `McpUiStyleVariableKey`, `McpUiResourceCsp`, display modes, all type-level contract |
| `src/styles.ts` | `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` |
| `src/types.ts` | Cross-cutting types referenced by the rest of the surface |
| `src/react/useApp.tsx` | React `useApp` hook |
| `src/react/useHostStyles.ts` | `useHostStyles`, `useHostStyleVariables`, `useHostFonts` |
| `src/react/useDocumentTheme.ts` | React equivalent of `applyDocumentTheme` |
| `src/react/useAutoResize.ts` | Iframe sizing helper |
| `src/message-transport.ts` | `PostMessageTransport`, transport contract |

### Examples (used to verify patterns, NOT inlined verbatim)

The digest references these by path in its Reference Index — it must NOT copy whole example files in.
Use them to sanity-check that the patterns described in the digest match real working code:

- `examples/basic-server-{vanillajs,react,vue,svelte,preact,solid}/` — minimal complete servers per framework
- `examples/basic-host/` — reference host implementation
- `examples/map-server`, `pdf-server`, `system-monitor-server` — mixed tool patterns (App tool + plain tool + app-only tool)
- `examples/scenario-modeler-server`, `cohort-heatmap-server`, `threejs-server`, `shadertoy-server`, `wiki-explorer-server`, `sheet-music-server`, `say-server`, `transcript-server`, `video-resource-server`, `debug-server` — domain-specific patterns

## Step 3: Write the Digest

Target file: `cli-template/FA-MCP-SDK-DOC/10-mcp-apps.md`.

### Required structure (linear, top → bottom, mandatory → optional)

The file MUST contain these sections in this order. Section names can be polished, but the contract
below is what makes the digest self-sufficient.

1. **Header / Version Pin**
   - Pinned `@modelcontextprotocol/ext-apps` version (e.g. `v0.7.1`)
   - Spec revision date (e.g. `2026-01-26`)
   - Upstream commit short SHA
   - Date the digest was regenerated
   - One-line note if a non-empty `specification/draft/` exists upstream

2. **What & Why** — one paragraph. MCP App = Tool + UI Resource pair linked via `_meta.ui.resourceUri`.
   The tool MUST still return a text `content` array (so non-UI hosts work); the UI is an
   enhancement, not a replacement.

3. **Architecture** — host iframe + server + `PostMessageTransport`; iframe sandbox / security
   model (including the desktop/native vs. web sandbox-proxy split documented in spec §
   Lifecycle step 2); capability negotiation (`getUiCapability`).

4. **Lifecycle / Workflow** — copy the four mermaid sequence diagrams from `apps.mdx` § Lifecycle
   **verbatim**, in order:
   1. *Connection & Discovery* — `resources/list` + `tools/list`
   2. *UI Initialization* — `tools/call` → `ui/initialize` → `ui/notifications/initialized` →
      `ui/notifications/tool-input-partial` (0..n) → `ui/notifications/tool-input` →
      `ui/notifications/tool-result` | `ui/notifications/tool-cancelled`
   3. *Interactive Phase* — branches for `tools/call`, `ui/message`,
      `ui/update-model-context`, `notifications/message`, `resources/read`, and
      size/host-context notifications
   4. *Cleanup* — `ui/resource-teardown`

   Do NOT paraphrase the diagrams. Reproduce each ```mermaid fenced block as-is so message names
   and arrow directions are preserved letter-for-letter. Renumber the surrounding sections of the
   digest accordingly.

5. **Protocol Contract** — normative, use MUST / SHOULD / MAY as in the spec:
   - `ui://` URI scheme and `RESOURCE_MIME_TYPE`
   - `_meta.ui` keys at tool level, resource level, content level
   - Server↔host capability negotiation
   - Host↔UI JSON-RPC messages (each with shape and direction):
     `tool/input`, `tool/inputPartial`, `tool/result`, `host/context`, `display/mode`,
     `server/tool/call`, `model/context`, `host/message`, `tool/log`, `teardown`
   - CSP and CORS rules — what goes in which `_meta` object (`contents[]` vs resource config)

6. **TypeScript SDK API** — minimum needed to build/maintain an app:
   - `registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE`, `getUiCapability`
   - `App` class with every handler signature
   - `PostMessageTransport`
   - Style helpers: `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts`
   - React hooks: `useApp`, `useHostStyles`, `useHostStyleVariables`, `useHostFonts`,
     `useDocumentTheme`, `useAutoResize`

   Each API: signature + one minimal idiomatic snippet + return-shape notes. Do NOT dump full source.

7. **Host Context** — every field of `McpUiHostContext` (`theme`, `styles.variables`,
   `styles.css.fonts`, `safeAreaInsets`, `availableDisplayModes`, `displayMode`, `viewUUID`,
   `locale`, etc.) and the canonical CSS variable groups (`--color-*`, `--font-*`,
   `--border-radius-*`). Pull the exhaustive list from `src/spec.types.ts`.

8. **Patterns / Recipes** — short recipes with minimal code, one per pattern:
   app-only tools (`visibility: ["app"]`), streaming partial input, polling + visibility pause,
   chunked / paginated data, binary resources, view state persistence (`viewUUID` + localStorage),
   model context (`sendMessage`, `updateModelContext`), fullscreen mode, graceful degradation,
   error handling (`isError`), CSP for external resources, debug logging (`sendLog`).

9. **Authorization** — OAuth/auth flow for apps that need authenticated requests; how the UI obtains
   credentials and where the host injects them.

10. **Testing** — `basic-host` workflow (commands, `SERVERS` env), `sendLog` for in-host debugging,
    what to verify (text fallback still works, UI renders, handlers fire, host styling applies).

11. **Common Pitfalls** — handlers registered after `app.connect()`, forgotten text `content`
    fallback, `_meta.ui.csp` / `_meta.ui.domain` in the wrong object, hardcoded theme colors,
    missing `vite-plugin-singlefile`, version numbers written from memory.

12. **Examples — When to Consult Which** — curated map of upstream `examples/` by use case, so the
    LLM consuming the digest can pick the right reference server without re-discovery. Build the
    section by walking every directory under `examples/` in the cloned tag, reading each example's
    `package.json` (`description` field) and `README.md` (first heading + opening paragraph), and
    classifying it into one of these subsections:

    - **12.1 Smallest end-to-end skeleton** — `examples/quickstart/` (single tool + minimal vanilla
      View) and `examples/basic-host/` (reference host harness — local testing only, NOT a
      production host).
    - **12.2 Mixed tool patterns** — servers combining App-augmented tools, plain tools, and
      app-only tools in one server (canonical: `map-server`, `pdf-server`, `system-monitor-server`).
      Spell out the actual tool composition per row, e.g. `display_pdf` (App tool) + `list_pdfs`
      (plain tool) + `read_pdf_bytes` (app-only chunked).
    - **12.3 Per-framework starter templates** — every `examples/basic-server-{framework}/`
      directory found in the tag. One row per framework.
    - **12.4 Domain references — pick by use case** — every remaining example under `examples/`,
      one row per server. Each row is `Domain | Example link | What it shows`. The "What it shows"
      cell MUST be grounded in the example's own `README.md` / `package.json` "description" field
      and SHOULD name the concrete libraries / patterns the example demonstrates (e.g. "Three.js +
      streaming tool input into canvas, OrbitControls, post-processing"). Group hint by domain
      (Charts, Analytics drill-down, 3D visualization, WebGL/shaders, Graph visualization,
      Audio/music, Streaming + audio, Browser APIs, Binary/media resources, Image generation,
      SDK surface reference, Full SDK API exercise, etc.). When new examples appear upstream they
      MUST be added here even if their domain doesn't match the existing buckets — invent a new
      bucket label rather than dropping the example.

    All example links in this section MUST use the tag-pinned form
    `https://github.com/modelcontextprotocol/ext-apps/tree/v<X.Y.Z>/examples/<name>` (note `tree`,
    not `blob`, since these target directories). The whole section is regenerable from upstream
    sources alone — never inline contents of an example's `README.md` or copy its source.

13. **Reference Index** — table mapping every aspect of the digest back to its upstream source.
    Every "Upstream source" cell MUST be a markdown link of the form
    `[<display path>](https://github.com/modelcontextprotocol/ext-apps/blob/v<X.Y.Z>/<path>)` —
    pinned to the **same** `v<X.Y.Z>` recorded in the digest header so future readers (and the LLM
    consuming the digest) can fetch the exact code corresponding to the digest. Never link to `main`
    or to an unpinned ref. For directory targets (e.g. example servers) use
    `https://github.com/modelcontextprotocol/ext-apps/tree/v<X.Y.Z>/<path>`. For deep links to
    spec sections, append the appropriate `#anchor` (e.g. `#lifecycle`).

    | Aspect | Upstream source (tag-pinned) | Why look here |
    |--------|------------------------------|---------------|
    | Wire protocol | [`specification/2026-01-26/apps.mdx`](https://github.com/modelcontextprotocol/ext-apps/blob/v<X.Y.Z>/specification/2026-01-26/apps.mdx) § N | Normative MUST/SHOULD/MAY |
    | Lifecycle diagrams | [`specification/2026-01-26/apps.mdx` § Lifecycle](https://github.com/modelcontextprotocol/ext-apps/blob/v<X.Y.Z>/specification/2026-01-26/apps.mdx#lifecycle) | Canonical message order (verbatim mermaid) |
    | `App` handlers | [`src/app.ts`](https://github.com/modelcontextprotocol/ext-apps/blob/v<X.Y.Z>/src/app.ts) | Signatures + JSDoc |
    | Server helpers | [`src/server/index.ts`](https://github.com/modelcontextprotocol/ext-apps/blob/v<X.Y.Z>/src/server/index.ts) | `registerAppTool` etc. |
    | Type-level contract | [`src/spec.types.ts`](https://github.com/modelcontextprotocol/ext-apps/blob/v<X.Y.Z>/src/spec.types.ts) | `McpUiHostContext`, CSP types |
    | React surface | [`src/react/`](https://github.com/modelcontextprotocol/ext-apps/tree/v<X.Y.Z>/src/react) | Hook contracts |
    | Pattern catalog | [`docs/patterns.md`](https://github.com/modelcontextprotocol/ext-apps/blob/v<X.Y.Z>/docs/patterns.md) | Authoritative recipes |
    | CSP / CORS rules | [`docs/csp-cors.md`](https://github.com/modelcontextprotocol/ext-apps/blob/v<X.Y.Z>/docs/csp-cors.md) | Where the keys go |
    | Mixed tool servers | [`examples/map-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/v<X.Y.Z>/examples/map-server), [`pdf-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/v<X.Y.Z>/examples/pdf-server), [`system-monitor-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/v<X.Y.Z>/examples/system-monitor-server) | App tool + plain + app-only patterns |
    | Domain examples | linked individually per server under [`examples/`](https://github.com/modelcontextprotocol/ext-apps/tree/v<X.Y.Z>/examples) | Domain-specific working code |

### Style rules (must match siblings in FA-MCP-SDK-DOC/)

- Hard wrap at 120 chars. Target 100–120. No 60–80 lines. Do NOT wrap URLs, code blocks, or tables.
- No emoji. No marketing language ("blazingly", "magnificent", "100% secure", etc.).
- Normative passages in the Protocol Contract section use MUST / SHOULD / MAY verbatim from the spec.
- Code snippets are minimal and reproducible. Prefer TypeScript. No incomplete `// ...` ellipses
  inside critical examples.
- Do NOT include `migrate_from_openai_apps.md` content — it serves a migration audience, not the
  digest's audience.
- Mention `vite-plugin-singlefile` (and other build tooling) only where it affects protocol
  conformance (assets in a sandboxed iframe) — the digest is a reference document, not a
  scaffolding guide.

### Cross-checks before writing

Before saving the digest, verify:

1. Every API name in the digest exists in `src/app.ts` or `src/server/index.ts` of the cloned tag.
   Renames in the upstream SDK are the #1 source of staleness.
2. Every JSON-RPC message name in the Protocol Contract section matches the spec verbatim.
3. Every CSS variable group in the Host Context section is grounded in `src/spec.types.ts`
   (`McpUiStyleVariableKey`).
4. Every example path in the Reference Index actually exists under `examples/` in the cloned tag.
5. The Common Pitfalls list is grounded in the upstream sources read in Step 2 — typically issues
   highlighted across `docs/patterns.md`, `docs/csp-cors.md`, `docs/testing-mcp-apps.md`, and the
   JSDoc warnings in `src/app.ts` and `src/server/index.ts`.
6. All four mermaid lifecycle diagrams from `apps.mdx` § Lifecycle (Connection & Discovery, UI
   Initialization, Interactive Phase, Cleanup) appear in the digest verbatim, inside ```mermaid
   fenced blocks. Diff the diagram text against the cloned tag character-by-character — message
   names like `ui/notifications/tool-input-partial` must match exactly.
7. Every URL in the Reference Index AND in the "Examples — When to Consult Which" section is
   pinned to the same `v<X.Y.Z>` tag recorded in the digest header. Grep for `/blob/main/`,
   `/tree/main/`, or any other version string — there must be zero matches besides the pinned tag.
8. Every directory under `examples/` in the cloned tag (excluding `run-all.ts` and any non-server
   helper files) is represented in exactly one row of section 12. Diff `ls examples/` against the
   section's row count — drift indicates a new upstream example that the digest hasn't classified
   yet.

If the file already exists, diff the new digest against the old one and surface the deltas to the
user before overwriting — that's how the user sees what changed upstream.

## Step 4: Update the Index Files

### `cli-template/FA-MCP-SDK-DOC/00-FA-MCP-SDK-index.md`

Add (or refresh) a one-line entry that points at `10-mcp-apps.md`. Match the bullet/table style
already used in that file for the other 0X documents. The entry should say what the file owns:
"Self-contained digest of the MCP Apps protocol + SDK pinned to `@modelcontextprotocol/ext-apps
v<X.Y.Z>`."

### `cli-template/CLAUDE.md`

In the "Framework Documentation" table (the section listing every `0X-*.md` file under
`FA-MCP-SDK-DOC/`), add or refresh the row:

| File | When to Read |
|------|--------------|
| `10-mcp-apps.md` | Building / extending MCP Apps (UI-augmented tools) — protocol contract, SDK surface, patterns, pitfalls |

Use the same single-line format as the other rows. Do not introduce sub-headings or bullets in this
table.

## Step 5: Cleanup

Remove the cloned temp dir:

```bash
rm -rf "${TMP_DIR%/mcp-ext-apps}"
```

If the run is interrupted mid-way, the temp dir is harmless (it's outside the repo and gitignored
by being outside) but should still be removed on the next run.

## Output Summary (what to report to the user)

After the digest is written, report:

- Pinned `@modelcontextprotocol/ext-apps` version + commit SHA
- Spec date used
- A short bullet list of deltas vs. the previous digest (if one existed) — renamed APIs, new
  protocol messages, removed patterns, etc.
- The three edited paths

Keep the report under 200 words. The diff matters more than the prose.
