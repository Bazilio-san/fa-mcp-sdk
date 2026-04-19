---
name: deploy-mcp
description: "Scaffold, implement, test, and push a new fa-mcp MCP server project end-to-end. Use when the user asks to create/bootstrap/deploy a new MCP server, mentions 'deploy-mcp', 'развернуть MCP', 'создать MCP проект', or provides a fa-mcp CLI config and a feature description. Orchestrates: validate cli-config → run `fa-mcp` → generate secrets → set lenient dev config → draft implementation plan → implement tools/prompts/resources → iterate via Agent Tester headless API → create GitLab repo and push."
disable-model-invocation: true
argument-hint: "<path-to-cli-config.yaml>"
allowed-tools: Bash(node *), Bash(fa-mcp *), Bash(npm *), Bash(yarn *), Bash(git *), Bash(pwd), Bash(cd *), Bash(curl *), Read, Write, Edit, Glob, Grep
---

# Deploy MCP — end-to-end bootstrap

Scaffold a new MCP server from a fa-mcp CLI config, implement it against a feature brief,
iteratively refine via the Agent Tester headless API, and push the result to GitLab.

All supporting scripts live in `${CLAUDE_SKILL_DIR}/scripts/` and are invoked with `node`.

## Ground rules

- **Every step is explicit and verified**. Do NOT silently skip a step. If a step fails, stop and report.
- **Never ask the user with predefined options for free-form input** (usernames, paths, tokens, keys, URLs).
  Ask the question in plain prose; the user types the answer.
- **Respect exclusions from the accompanying text**. If it says "no AD" or "no Consul" — do NOT
  ask for those creds and do NOT configure them.
- **One config source of truth**: the path the user passed (`cli-config.yaml`). Rewrite it in place
  with `scripts/set-cli-config.js` — do NOT invent a parallel file.
- **Dev-time defaults are lenient on purpose** (auth off, Consul off, Agent Tester on). Production
  config comes later; this skill is about getting the loop closed.

## Step 1 — Parse and validate the CLI config

Parse `$ARGUMENTS` for the config path. If missing, ask:
> "Укажи путь к CLI-конфигу fa-mcp (YAML или JSON). Пример: `./cli-config.yaml`."

Then validate:

```
node ${CLAUDE_SKILL_DIR}/scripts/validate-cli-config.js <path>
```

The script prints JSON with `missing` and `filled` arrays. For every entry in `missing`:

1. Ask the user for the value in plain prose (e.g. *"Как назовём проект? (`project.name`)"*).
2. Write it back:
   ```
   node ${CLAUDE_SKILL_DIR}/scripts/set-cli-config.js <path> <key> "<value>"
   ```
3. Re-run the validator until `missing` is empty.

Also set `forceAcceptConfig: "y"` if not already set — otherwise `fa-mcp` will halt for an
interactive confirmation and you can't see the prompt.

## Step 2 — Collect and verify Agent Tester OpenAI credentials

These are NOT part of the CLI config; they go into the generated project's `config/local.yaml`
after step 4. Ask once, remember for step 5:

- `agentTester.openAi.apiKey` — required for Agent Tester to drive tool calls.
- `agentTester.openAi.baseURL` — optional (Azure / proxy / local LLM). Ask if empty.

If the user's accompanying text already supplied them, use those and don't re-ask.

**Verify the key against the endpoint NOW**, not later — a broken key uncovered after scaffolding,
installing, implementing, and building is a very expensive failure. Run:

```
node ${CLAUDE_SKILL_DIR}/scripts/check-openai.js --key "<apiKey>" [--base-url "<baseURL>"]
```

Exit code semantics:
- `0` — OK (2xx from `GET /v1/models`). Remember the creds and continue.
- `1` — key rejected (401/403). Tell the user, ask for a replacement, re-check. Do NOT continue.
- `2` — transport error (DNS/TLS/timeout). Likely wrong `baseURL` or offline — ask the user, re-check.
- `3` — unexpected HTTP status. Show the response body; some proxies don't implement `/v1/models`.
  Let the user explicitly choose to proceed anyway (record the choice in the final report).

## Step 3 — Scan the accompanying text for requirements

Before running the CLI, read every message/file the user attached and extract:

- **Tool requirements** — what the MCP server must expose (tools, resources, prompts, REST endpoints).
- **Source-of-truth references** — existing code paths (e.g. "wrap the tools in `D:/foo/bar/`"),
  public APIs to proxy, or other MCP projects to crib from. If a path is given, use Read/Glob/Grep
  on it to understand the surface area before writing code. If an API is named, fetch its docs
  (Context7 / WebFetch) before guessing at parameters.
- **Exclusions** — "no AD", "no Consul", "no DB", etc. Record them; do not ask for those creds later.
- **Additional creds required by the feature** (DB user/password, upstream service tokens, AD
  service account, etc.). Ask for ONLY what the feature actually needs and nothing the text excluded.

Summarize what you found to the user in 3-6 bullets and get a one-line confirmation before proceeding.

## Step 4 — Run fa-mcp

```
fa-mcp <path-to-cli-config.yaml>
```

This creates the project at `projectAbsPath` from the config and copies `cli-template/` + `config/`
+ `src/template/` into it. On success, it prints the created directory.

If the command exits non-zero, stop and surface the error.

## Step 5 — Generate secrets and set dev-time config

Switch the working directory to the generated project root for the rest of the flow.

Run the secrets generator with the OpenAI creds from step 2 (pass only what you have):

```
node ${CLAUDE_SKILL_DIR}/scripts/gen-secrets.js <projectAbsPath> \
  --openai-key "<apiKey>" \
  --openai-base-url "<baseURL>"
```

This writes into `<projectAbsPath>/config/local.yaml`:

- `webServer.auth.jwtToken.encryptKey` — fresh UUIDv4
- `webServer.auth.permanentServerTokens` — `[<32-char hex>]`
- `agentTester.openAi.apiKey` / `.baseURL` — when provided
- Lenient dev defaults: `agentTester.{enabled:true, showFooterLink:true, useAuth:false}`,
  `consul.service.enable:false`, `webServer.auth.enabled:false`, `adminPanel.enabled:false`.

Report the wrote-keys list back to the user (NOT the actual secret values).

## Step 6 — Install deps & initial build

From the project root:

```
npm install
npm run cb        # clean build
```

If `cb` fails, fix compilation errors before continuing — the rest of the skill depends on a
working build.

## Step 7 — Draft and commit to a plan

Create `<projectRoot>/claudedocs/impl-plan.md` (create the directory if needed). Structure:

```markdown
# Implementation Plan — <project name>

## Goal
<One paragraph restating the feature from the accompanying text.>

## Tools
- [ ] `<tool_name>` — <description>; params: …; expected result: …
- [ ] …

## Resources
- [ ] `<resource_uri>` — …

## Prompts
- [ ] `AGENT_BRIEF` — …
- [ ] `AGENT_PROMPT` — …

## REST endpoints (if any)
- [ ] `GET /api/<…>` — …

## Configuration additions to default.yaml
- [ ] `accessPoints.<name>` / `db.postgres.dbs.<name>` / etc.

## Test cases (tests/mcp/test-cases.js)
- [ ] happy path per tool
- [ ] invalid params / missing required
- [ ] upstream errors

## Agent Tester scenarios
- [ ] <user-question-1> → expects <tool>/<behaviour>
- [ ] …

## Sign-off
- [ ] `yarn cb` clean
- [ ] `yarn lint:fix` clean
- [ ] `yarn typecheck` clean
- [ ] `yarn test:mcp`, `:mcp-http`, `:mcp-sse` all green
- [ ] Agent Tester iterations done, `claudedocs/test-log.md` has entries
- [ ] `claudedocs/dev-report.md` written
- [ ] GitLab repo created and pushed
```

Tick boxes as you go. The plan is not optional — it is how the user audits progress.

## Step 8 — Implement

Follow the plan. For each tool/resource/prompt:

1. Edit `src/tools/tools.ts`, `src/tools/handle-tool-call.ts`, `src/custom-resources.ts`,
   `src/api/router.ts`, `src/prompts/*` as needed. Replace the stub `example_tool` — do not
   leave demo code in the final build.
2. Add new config keys to `config/default.yaml` (and matching env mappings in
   `config/custom-environment-variables.yaml` when appropriate). Mirror structural changes
   in `config/_local.yaml`.
3. Update `tests/mcp/test-cases.js` with real cases.
4. `yarn cb` after each meaningful change; don't accumulate type errors.

Reference docs live in `FA-MCP-SDK-DOC/` inside the generated project — read them if you
are unsure about an API (`01-getting-started.md`, `02-1-tools-and-api.md`,
`02-2-prompts-and-resources.md`, `03-configuration.md`, `08-agent-tester-and-headless-api.md`).

## Step 9 — Headless Agent Tester loop

The key was already verified against the endpoint in Step 2. Here the remaining concern is that
`config/local.yaml` was written correctly and the project can actually load the key at runtime.
Run the project's own `check-llm` as a config-path sanity gate:

```
npm run check-llm
```

Non-zero exit at this point almost always means the key wasn't persisted into `config/local.yaml`
(or the project reads a different path than expected) — NOT that the key itself is invalid. Diagnose
by checking `config/local.yaml` for `agentTester.openAi.apiKey` before asking the user for a new key.

Start the server (background):

```
npm start &
```

Check it came up:

```
curl -sS http://localhost:<port>/agent-tester/api/mcp/status
```

(`<port>` comes from the CLI config / `config/default.yaml`.) Verify the expected tools are listed.

Then iterate. For each scenario in the plan:

```
node ${CLAUDE_SKILL_DIR}/scripts/headless-test.js \
  --port <port> \
  --message "<user question>" \
  --verbose
```

Parse the JSON response. Check:

- `trace.tools_used` — the agent called the expected tool?
- `trace.turns[].tool_calls[].arguments` — args match what the question implies?
- `trace.turns[].tool_results[].result` — handler returned sensible data?
- `message` — final reply is accurate and useful?
- `trace.system_prompt_sent` — the prompt actually sent (useful when iterating on `AGENT_PROMPT`).

When something is off, diagnose the root cause (one of: tool description, parameter schema,
agent prompt, handler logic, error message — per `FA-MCP-SDK-DOC/08-agent-tester-and-headless-api.md`),
fix, rebuild (`yarn cb`), restart, and re-run the scenario.

Log every iteration in `claudedocs/test-log.md` (session header + per-scenario: sent / expected /
received / tools used / result / diagnosis / fix). This is the audit trail.

Stop the server with `node scripts/kill-port.js <port>` (or Ctrl+C) when you're done iterating.

## Step 10 — Final quality gates

All of these must be clean before pushing:

```
yarn lint:fix
yarn typecheck
yarn cb
yarn test:mcp
yarn test:mcp-http
yarn test:mcp-sse
```

Zero errors, zero warnings that matter, all transport tests green.

Write `claudedocs/dev-report.md` per the structure in `cli-template/CLAUDE.md` → "Development Report"
(what was built, architecture decisions, agent prompt rationale, test coverage, Agent Tester findings,
configuration, known limitations).

## Step 11 — Push to GitLab

Collect GitLab credentials — prefer values already in the accompanying text, ask only for what's missing:

- `baseUrl` — e.g. `https://gitlab.finam.ru/api/v4`
- `token` — GitLab private token with `api` scope
- `group` — group name or full path (e.g. `mcp-servers` or `ai/mcp`), OR `groupId` numeric

If the user gives a group **name**, the push script resolves it to `groupId` via `GET /groups?search=<name>`.

Run:

```
node ${CLAUDE_SKILL_DIR}/scripts/gitlab-push.js \
  --base-url "<baseUrl>" \
  --token "<token>" \
  --group "<group>" \
  --name "<project.name>" \
  --cwd "<projectAbsPath>"
```

The script:

1. Resolves `groupId` from `--group` (or uses `--group-id` directly).
2. Creates the project via `POST /projects` with `{ name, path, namespace_id, visibility: private }`.
3. `git init` (if needed) → `git checkout -B main` → `git add -A` → commit (if anything to commit)
   → `git remote add origin <ssh_url>` → `git push -u origin main`.

If creation or push fails, surface the HTTP body / git stderr to the user — do NOT retry silently.
A common failure is "path has already been taken" — ask the user for a different `--path` (URL slug).

## Final report

Tell the user:

1. `<projectAbsPath>` — where the project lives on disk.
2. GitLab web URL of the new repo.
3. Summary of tools/resources/prompts/endpoints that were implemented.
4. Any flagged limitations from the dev report.
5. Link to `claudedocs/impl-plan.md`, `claudedocs/test-log.md`, `claudedocs/dev-report.md`.

## Troubleshooting

**`fa-mcp: command not found`** — the CLI isn't installed globally. Run `npm install -g fa-mcp-sdk`
first, or invoke the bundled binary: `node <path-to-fa-mcp-sdk>/bin/fa-mcp.js <config>`.

**`Directory not empty`** from fa-mcp — `projectAbsPath` already has files. Either pick a fresh path
or clear the directory (`.git`, `.idea`, `node_modules` are allowed; anything else blocks creation).

**Agent Tester returns 404 on `/agent-tester/*`** — `agentTester.enabled` is false. `gen-secrets.js`
sets it true; if still 404, rebuild (`yarn cb`) and verify `config/local.yaml` after the run.

**Headless test returns `modelConfig` errors** — the OpenAI key is wrong / out of credits / the model
name doesn't exist on the configured `baseURL`. Run `npm run check-llm -- <model-name>` to isolate.

**GitLab push fails with 401** — token lacks `api` scope or expired. Ask for a fresh token.

**GitLab push fails with "path has already been taken"** — slug collision. Ask the user for a
different `--path` value (the URL slug, separate from `--name`).
