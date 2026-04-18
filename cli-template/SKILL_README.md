# Skills (Claude Code)

Skills are specialized instructions for Claude Code, located in `.claude/skills/`. They are invoked inside Claude Code
chat — either by a `/command` or automatically by trigger phrases.

## Available Skills

### `/gen-jwt` — JWT Token Generator

Generates JWT tokens for MCP server authentication via `scripts/generate-jwt.js`.

- **Launch**: by command `/gen-jwt` or by trigger phrases ("jwt", "token for user", "токен для", "сгенерируй токен")
- **Interactive**: asks for missing required params (username, TTL), then optional (request ID, IP restriction,
  service name, extra `key=value` pairs)
- **Parameters**:
  - `username` (REQUIRED) — user the token is issued to
  - `ttl` (REQUIRED) — lifetime in format `<N>s | <N>m | <N>d | <N>y`
  - `request` (optional) — ticket/issue ID (e.g. `REQ-123`, `JIRA-456`)
  - `ip` (optional) — allowed IPs / CIDR masks, comma-separated
  - `service` (optional) — service name, passed as `-s <name>` flag
  - any additional `key=value` pairs — appended to the token payload
- **Output**: token string, payload table, saved to `<YYYYMMDD-HHmmss>-jwt.txt` in the project root

**Examples:**

```
/gen-jwt admin 30d
/gen-jwt vpupkin 1y request=REQ-12345 ip=10.0.0.0/24,192.168.1.100
/gen-jwt svc-account 8d service=my-mcp
/gen-jwt sergey на год привязать к заявке REQ-555
```

---

### `/upgrade-guide` — FA-MCP-SDK Upgrade Guide

Generates a migration guide for upgrading the `fa-mcp-sdk` dependency in this project. Analyzes diffs in:

- `config/*.yaml` — new/removed/changed keys and defaults (correlates `default.yaml`, `_local.yaml`, `local.yaml`)
- `cli-template/` — `package.json` (new deps only), `tsconfig.json`, `eslint.config.js`, `CLAUDE.md`, `deploy/`,
  `.claude/skills/`, `.run/` (from `r/`)
- `scripts/` — new or updated SDK utilities (excluding SDK-internal `copy-static.js`, `publish.sh`)
- `dist/core/index.js` — added/removed/renamed exports and breaking type changes
- project `src/` — imports and config keys affected by the upgrade

By default, versions and commit hashes refer to **this project** — the skill resolves them to the pinned SDK version
via `git show <ref>:package.json`. To reference SDK versions/commits directly, mention "SDK" explicitly.

- **Launch**: by command `/upgrade-guide` or by trigger phrases ("обновить sdk", "upgrade sdk", "migration guide",
  "обновление fa-mcp-sdk")
- **Output**: `upgrade-guide-<old>-to-<new>.md` in project root

**Examples:**

```
/upgrade-guide                                               # current SDK -> latest SDK
/upgrade-guide 1.2.3                                         # project version 1.2.3 -> latest SDK
/upgrade-guide 1.2.3 1.2.7                                   # project versions
/upgrade-guide abc1234 def5678                               # project commits
/upgrade-guide from SDK version 0.1.30                       # SDK versions directly -> latest SDK
/upgrade-guide from SDK version 0.1.30 to SDK version 0.5.0  # SDK versions directly
/upgrade-guide from SDK commit abc1234 to SDK commit def5678 # SDK commits directly
/upgrade-guide 1.2.3 1.2.7 in Russian                        # output guide in Russian
/upgrade-guide 1.2.3 1.2.7 на русском                        # same, via Russian phrasing
```

---

### `/feature-generator` — Feature Prompt Generator

A **META-skill**: turns a feature description into a self-sufficient prompt for an AI CLI (Claude Code or another
agent) to implement the feature turnkey. The skill itself does NOT write feature code — it produces the prompt.

What it does:

- Inspects real code via `Read` / `Grep` / `Glob` — **no guessing**
- Identifies reusable functions, classes, types, and existing npm dependencies (with `file:line` citations)
- Designs the minimal sufficient solution (KISS / YAGNI / DRY), applying multi-role review
  (Architect / Senior dev / QA)
- Drafts a change plan (file → action → what exactly), code examples with TypeScript typing,
  and a testing scenario
- Outputs a Part A brief summary + Part B self-sufficient 15-section prompt ready to hand off to an AI CLI

Characteristics:

- **Launch**: **command-only** via `/feature-generator`. Has `disable-model-invocation: true` — does NOT activate
  on trigger phrases or implicit mentions
- **Input**: free-form feature description OR path to a file with the description (e.g. `task.md`, ticket dump)
- **Output**: file `prop-<kebab-name>.md` in repository root. If the file already exists, a numeric suffix is
  appended (`-2`, `-3`, …) — the existing file is never overwritten

**Examples:**

```
/feature-generator Add a tool for batch-processing customer records across a project
/feature-generator task.md
/feature-generator REQ-1234: implement webhook callback receiver for external events
/feature-generator Add OAuth2 token refresh logic to the HTTP client
```
