---
name: create-mcp-wizard
description: "Implement an fa-mcp MCP server end-to-end in this already-scaffolded project: verify Agent Tester OpenAI creds, seed dev-time secrets and lenient config, push the scaffold to GitLab (creating a new repo OR reusing an existing one when instructed), draft an implementation plan, implement tools/prompts/resources, iterate via the Agent Tester headless API, then push the finished work. Use when the user asks to develop/implement/deploy the MCP server in this project, mentions 'create-mcp-wizard', 'deploy MCP', 'implement MCP', or supplies a feature brief."
disable-model-invocation: true
allowed-tools: Bash(node *), Bash(yarn *), Bash(npm *), Bash(git *), Bash(pwd), Bash(cd *), Bash(curl *), Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
---

# Deploy MCP — feature implementation

Implement this MCP server against a feature brief, iteratively refine via the Agent Tester headless
API, and push the result to GitLab. The project has **already been scaffolded** by the `fa-mcp` CLI —
this skill picks up from the first `yarn install` and ends with the finished feature pushed to GitLab.

The skill makes **two GitLab pushes**: the first (Step 5) lands the scaffolded, configured project
on the remote so the rest of the work is tracked; the second (Step 10) pushes the implemented and
tested feature on top. In Step 5 the remote is either created via `gitlab-push.js` (default) or
reused as-is when the accompanying instructions say a repo already exists or `origin` is already
wired up — no duplicate projects get created.

All supporting scripts live in `${CLAUDE_SKILL_DIR}/scripts/` and are invoked with `node`.

## Ground rules

- **Every step is explicit and verified**. Do NOT silently skip a step. If a step fails, stop and report.
- **Two hard stops require the user's word before you continue**: the end of Step 1 (the requirements and
  the source research are confirmed) and the end of Step 6 (the plan is approved). Nothing gets built
  before both are passed, and neither can be satisfied by writing a file and moving on.
- **Never ask the user with predefined options for free-form input** (usernames, paths, tokens, keys,
  URLs). Ask the question in plain prose; the user types the answer.
- **Respect exclusions from the accompanying text**. If it says "no AD" or "no Consul" — do NOT
  ask for those creds and do NOT configure them.
- **Dev-time defaults are lenient on purpose** (auth off, Consul off, Agent Tester on). Production
  config comes later; this skill is about getting the loop closed.
- **You are already inside the project root.** All paths are relative to the current working
  directory unless stated otherwise. Use `pwd` once at the start to confirm.
- **Do not touch `.claude/`, `deploy/`, or `FA-MCP-SDK-DOC/`.** These directories are maintained
  by the CLI / skill infrastructure and by the SDK maintainer. Do NOT modify, add, or delete files
  inside them unless the accompanying text explicitly instructs you to. This applies to every step
  below — implementation, tests, dev report, everything. Reading them is expected and encouraged; the
  ban is on writing.
- **Shared references.** Two documents next to this skill are part of it and are read, not summarized:
  `${CLAUDE_SKILL_DIR}/../_shared/source-research.md` — how a source of truth is studied (Step 1), and
  `${CLAUDE_SKILL_DIR}/../_shared/prompt-plan-format.md` — how the plan document is written (Step 6).
  They are shared with other skills; do not copy their contents into project files.
- **Reporting language**. Language for all generated artifacts (`claudedocs/*.md`, commit
  messages, user-facing summaries) is resolved in this order:
    1. Explicit directive in the feature brief.
    2. Else, contents of `preferred-language.txt` in the project root, if it exists.
    3. Else — English.
  Translate prose — headings and body text — to the resolved language; leave code, paths, YAML
  keys, and CLI commands as-is. Report the resolved language and its source in the Step 1 summary.

## Step 1 — Scan the accompanying text and research the source of truth

This step decides what gets built. It has two halves: reading what the user handed over, and going out
to the source that the future MCP server will speak for.

**1a. Extract from the accompanying text.** Read every message and file the user attached and pull out:

- **Tool requirements** — what the MCP server must expose (tools, resources, prompts, REST endpoints).
- **Source-of-truth references** — where the knowledge actually lives: a code path
  (e.g. "wrap the tools in `D:/foo/bar/`"), a public API to proxy, a database, a specification, or
  another MCP project to crib from. This is the input to half 1b below.
- **Exclusions** — "no AD", "no Consul", "no DB", etc. Record them; do not ask for those creds later.
- **Additional creds required by the feature** (DB user/password, upstream service tokens, AD
  service account, etc.). Ask for ONLY what the feature actually needs and nothing the text excluded.
- **Agent Tester OpenAI creds** — `apiKey` (required for Step 2) and `baseURL` (optional — Azure /
  proxy / local LLM). If the text already supplies them, use those. If `config/local.yaml` already
  has a working `agentTester.openAi.apiKey`, re-use it instead of asking again.
- **Reporting language** — resolve per the Ground rule above; record it for later steps.

**1b. Research the source.** Read `${CLAUDE_SKILL_DIR}/../_shared/source-research.md` and follow it.
That document is the method: classify the source, read the project baseline, inventory the source's
operations with their inputs, outputs, access rules and limits, map those operations onto an MCP
surface that an agent can actually use, list what is already reusable in this project, and record
assumptions and open questions. Its rules are binding here — in particular, nothing is invented: a
path is read before it is cited, an API's documentation is fetched before its parameters are named,
and a source you could not open is reported as a blocker instead of being guessed at.

Skip 1b only when there is no external source at all — the user described the behaviour in full and
the server invents nothing from anywhere else. That is rare; when in doubt, do the research.

Summarize to the user: the findings from 1a in 3-6 bullets (including the resolved reporting language
and its source), plus the source-research output described at the end of `source-research.md` — the
inventory, the proposed tool surface, the reusable artifacts, the assumptions, and any open questions.
Get answers to the open questions and a one-line confirmation before proceeding.

## Step 2 — Verify Agent Tester OpenAI credentials

A broken key uncovered after implementing, building, and starting the server is a very expensive
failure. Verify NOW, before anything else touches `config/local.yaml`:

```
node ${CLAUDE_SKILL_DIR}/scripts/check-openai.js --key "<apiKey>" [--base-url "<baseURL>"]
```

Exit code semantics:
- `0` — OK (2xx from `GET /v1/models`). Remember the creds and continue.
- `1` — key rejected (401/403). Tell the user, ask for a replacement, re-check. Do NOT continue.
- `2` — transport error (DNS/TLS/timeout). Likely wrong `baseURL` or offline — ask the user, re-check.
- `3` — unexpected HTTP status. Show the response body; some proxies don't implement `/v1/models`.
  Let the user explicitly choose to proceed anyway (record the choice in the final report).

## Step 3 — Generate secrets and set dev-time config

The project already has `config/local.yaml` (seeded by the CLI from `config/_local.yaml`). Fill in
dev-time secrets and lenient defaults in place — existing values you didn't touch are preserved:

```
node ${CLAUDE_SKILL_DIR}/scripts/gen-secrets.js "$(pwd)" \
  --openai-key "<apiKey>" \
  --openai-base-url "<baseURL>"
```

This writes into `config/local.yaml`:

- `webServer.auth.jwtToken.encryptKey` — fresh UUIDv4
- `webServer.auth.permanentServerTokens` — `[<32-char hex>]`
- `agentTester.openAi.apiKey` / `.baseURL` — when provided
- Lenient dev defaults: `agentTester.{enabled:true, showFooterLink:true, useAuth:false}`,
  `consul.service.enable:false`, `webServer.auth.enabled:false`, `adminPanel.enabled:false`.

Report the wrote-keys list back to the user (NOT the actual secret values). If the developer has
hand-tuned dev flags they don't want clobbered, re-run with `--skip-lenient`.

## Step 4 — Install deps & initial build

From the project root:

```
yarn install
yarn cb        # clean build
```

If `cb` fails, fix compilation errors before continuing — the rest of the skill depends on a
working build.

## Step 5 — Clean branch, initial commit, create GitLab repo, first push

Before planning the feature, land the scaffolded + configured project on GitLab so the rest of
the work is tracked on the remote. The final push in Step 10 reuses whatever remote is wired up
here.

This step has two branches at the "remote" stage:

- **Create new repo** (default) — no pre-existing remote, user didn't veto creation.
- **Skip creation, push to existing remote** — triggered when the accompanying text explicitly
  says so ("don't create repo", "remote already exists", "push to `<url>`", "origin already
  configured" etc.), OR `git remote -v` already shows
  an `origin` pointing at GitLab. When in doubt, ASK the user before creating — it's cheap to
  confirm, expensive to recover from an accidental duplicate project.

**1. Inspect the working tree.** Run `git status` and report the state to the user in plain prose:
which files are new (untracked), which are modified, which are staged. The user needs to see this
before anything is committed.

**2. Branch must be clean — stash anything that shouldn't enter the initial commit.** "Clean"
means there are no untracked files and no unstaged modifications left over after you've decided
what belongs in the initial commit. If the tree contains scratch notes, local-only tweaks, or
anything the user flagged as not-for-commit, stash it with an untracked-inclusive stash:

```
git stash push -u -m "create-mcp-wizard: pre-initial-push stash" -- <paths>
```

Announce what you stashed so the user can recover it later via `git stash list` / `git stash pop`.
Re-run `git status` to confirm the tree now contains only files that belong in the scaffold commit.

**3. Commit the scaffolded state.** Stage everything that should be on the remote and commit with
a clear message:

```
git add -A
git commit -m "chore: initial scaffold (fa-mcp)"
```

If `git status` was already clean with a prior commit present, skip this — there is nothing new
to commit.

**4. Decide the branch.** Run `git remote -v` and compare against the accompanying text:

- If the text says "don't create" / "repo already exists" / names an explicit remote URL, OR
  `git remote -v` already shows an `origin` → go to **4a (skip creation)**.
- If neither signal is present, confirm creation with the user in one short question
  (e.g. *"Create a new GitLab repository or use an existing one? If existing — provide the
  URL."*), then branch accordingly.

### 4a. Skip creation — push to existing remote

No GitLab API call; no `gitlab-push.js`. Just wire `origin` to the existing URL and push:

```
# If origin isn't set yet, add it. If it's set to the wrong URL, update it.
git remote add origin <ssh-or-https-url>         # first time
# or
git remote set-url origin <ssh-or-https-url>     # replacing

git checkout -B main
git push -u origin main
```

Record the remote URL for Step 10. You do NOT need `baseUrl`, `token`, or `group` in this branch —
authentication happens via the user's existing SSH key / git credential helper. If the push fails
with an auth error, surface it to the user; do not attempt API-token workarounds.

### 4b. Create new repo via gitlab-push.js

Collect GitLab credentials — prefer values already in the accompanying text, ask only for what's
missing:

- `baseUrl` — e.g. `https://gitlab.corp.com/api/v4`
- `token` — GitLab private token with `api` scope
- `group` — group name or full path (e.g. `mcp-servers` or `ai/mcp`), OR `groupId` numeric

If the user gives a group **name**, the push script resolves it to `groupId` via
`GET /groups?search=<name>`.

```
node ${CLAUDE_SKILL_DIR}/scripts/gitlab-push.js \
  --base-url "<baseUrl>" \
  --token "<token>" \
  --group "<group>" \
  --name "<project.name>" \
  --cwd "$(pwd)"
```

The script: resolves `groupId` → `POST /projects` with `{ name, path, namespace_id, visibility: private }`
→ `git init` (if needed) → `git checkout -B main` → `git add -A` → commit (if anything to commit)
→ `git remote add origin <ssh_url>` → `git push -u origin main`.

If creation or push fails, surface the HTTP body / git stderr to the user — do NOT retry silently.
A common failure is "path has already been taken" — ask the user for a different `--path` (URL slug),
OR switch to branch 4a if the "collision" is in fact the already-existing target repo.

**5. Remember the remote URL for Step 10.** Step 10 does NOT re-create the project — only
`git push` against the same remote, regardless of which branch (4a or 4b) you took here.

## Step 6 — Draft the prompt-plan and commit to it

Create `claudedocs/impl-plan.md` (create the directory if needed) in the reporting language. This
document is a **prompt-plan** — an implementation plan written as a prompt for whoever carries it out.

**Read `${CLAUDE_SKILL_DIR}/../_shared/prompt-plan-format.md` and follow it.** That file is the single
source of truth for the format: the plain-language opening block, the note to the executor, the stage
checklist with boxes ticked as work genuinely lands, documentation as the last stage, and the
target-state wording. Do not reproduce those rules here and do not improvise around them.

The material for the opening block comes from Step 1 — the goal, the problem the source of truth is
being wrapped for, and what the user will be able to ask the agent once the server runs. The material
for the technical sections comes from the source research: the inventory, the proposed tool surface,
the reusable artifacts, and the configuration keys.

For this project the plan's technical sections and stages are the ones below; keep the two opening
sections exactly as the format file prescribes:

```markdown
## Scope

### Tools
- `<tool_name>` — <description>; params: …; expected result: …; file: `src/tools/<tool-name>.ts`

### Resources
- `<resource_uri>` — …

### Prompts
- `AGENT_BRIEF` — …
- `AGENT_PROMPT` — …

### REST endpoints (if any)
- `GET /api/<…>` — …

### Configuration in `config/default.yaml`
- `accessPoints.<name>` / `db.postgres.dbs.<name>` / etc.

## Implementation checklist

### Stage 1 — Tools
- [ ] `src/tools/<tool-name>.ts` — definition and handler in one file
- [ ] registered in the list in `src/tools/tools.ts`
- [ ] stub tools (`example-tool.ts`, `example-search.ts`, `example-long-task.ts`, `show-widget.ts`)
      deleted together with their entries in `tools.ts`

### Stage 2 — Resources, prompts, REST endpoints
- [ ] `src/custom-resources.ts`
- [ ] `src/prompts/agent-brief.ts`, `src/prompts/agent-prompt.ts`
- [ ] `src/api/router.ts`

### Stage 3 — Configuration
- [ ] keys added to `config/default.yaml`, external services under `accessPoints`
- [ ] env mappings in `config/custom-environment-variables.yaml`
- [ ] structure mirrored in `config/_local.yaml`

### Stage 4 — Tests
- [ ] happy path per tool in `tests/mcp/test-cases.js`
- [ ] invalid params / missing required fields
- [ ] upstream errors

### Stage 5 — Agent Tester scenarios
- [ ] <user-question-1> — expects tool `<tool>` and <behaviour>
- [ ] <user-question-2> — …

### Stage 6 — Documentation update
- [ ] `README.md` and `readme-docs/*` describe the tools, config keys, and endpoints as they are
- [ ] `claudedocs/dev-report.md` — full report
- [ ] `claudedocs/breef-report.md` — brief of the work and the problems
- [ ] `claudedocs/dev-problems.md` — blockers, failed checks, open questions
- [ ] `claudedocs/test-log.md` — every Agent Tester iteration logged

## Sign-off
- [ ] `yarn cb` clean
- [ ] `yarn lint:fix` clean
- [ ] `yarn typecheck` clean
- [ ] `yarn test:mcp`, `:mcp-http`, `:mcp-sse` all green
- [ ] Final GitLab push (Step 10) complete
```

The plan is not optional — it is how the user audits progress. Tick the boxes as you go.

### Stop here and get the plan approved

**This is a hard stop. Do NOT start Step 7 until the user has approved the plan.** Writing the file is
not approval, and silence is not approval. A plan that is implemented before anyone read it defeats
the purpose of writing one.

Print into the chat — not merely a link to the file, which nobody opens:

- the plain-language opening block, in full (it is short and it is the part the user actually judges);
- one line per tool: name, what it does, what it takes, what it returns;
- the stage headings of the checklist, so the user sees the order of work;
- anything still recorded as an assumption or an open question.

Then say where the full document lives (`claudedocs/impl-plan.md`) and ask one direct question: approve
as written, or what should change — the set of tools, the boundaries between them, the order of the
stages, the scope.

Handle the answer:

- **Approved** — go to Step 7.
- **Changes requested** — edit `claudedocs/impl-plan.md`, state in one or two sentences what changed,
  and ask again. Repeat until the user approves. Do not argue the plan into acceptance; if you think a
  requested change is wrong, say why in one sentence and then do what the user decided.
- **"Decide yourself"** — that is approval. Record the decisions you made under the assumptions in the
  plan, and go to Step 7.

Once approved, the plan is the contract for the rest of the run. If implementation reveals that
something in it cannot work as written, stop, say what and why, propose the correction, and get it
agreed before deviating — do not quietly build something other than what was approved.

## Step 7 — Implement

Follow the approved plan. For each tool/resource/prompt:

1. Create one file per tool in `src/tools/<tool-name>.ts` (the tool's `name` with `_` → `-`), each with
   its definition and handler together, and register it in the list in `src/tools/tools.ts` (see "Tool
   organization" in AGENTS.md). Edit `src/custom-resources.ts`, `src/api/router.ts`, `src/prompts/*` as
   needed. Remove the stub tool files (`example-tool.ts`, `example-search.ts`, `example-long-task.ts`,
   `show-widget.ts`) and their entries in `tools.ts` — do not leave demo code in the final build.
2. Add new config keys to `config/default.yaml` (and matching env mappings in
   `config/custom-environment-variables.yaml` when appropriate). Mirror structural changes
   in `config/_local.yaml`. **If the feature talks to any third-party / external service
   (REST API, legacy system, partner endpoint), put its connection attributes — `host`,
   `port`, `protocol`, `token`, credentials, custom fields — under the `accessPoints` block,
   not ad-hoc sections. See `FA-MCP-SDK-DOC/03-configuration.md` → "Access Points" for the
   YAML shape and access pattern.**
3. Update `tests/mcp/test-cases.js` with real cases.
4. `yarn cb` after each meaningful change; don't accumulate type errors.

Reference docs live in `FA-MCP-SDK-DOC/` — read them if you are unsure about an API
(`01-getting-started.md`, `02-1-tools-and-api.md`, `02-2-prompts-and-resources.md`,
`03-configuration.md`, `08-agent-tester-and-headless-api.md`).

## Step 8 — Headless Agent Tester loop

The key was already verified against the endpoint in Step 2. Here the remaining concern is that
`config/local.yaml` was written correctly and the project can actually load the key at runtime.
Run the project's own `check-llm` as a config-path sanity gate:

```
yarn check-llm
```

Non-zero exit at this point almost always means the key wasn't persisted into `config/local.yaml`
(or the project reads a different path than expected) — NOT that the key itself is invalid. Diagnose
by checking `config/local.yaml` for `agentTester.openAi.apiKey` before asking the user for a new key.

Start the server (background):

```
yarn start &
```

Check it came up:

```
curl -sS http://localhost:<port>/agent-tester/api/mcp/status
```

(`<port>` comes from `config/default.yaml` → `webServer.port`.) Verify the expected tools are listed.

Then iterate. For an **independent** scenario (one-shot question, no prior context):

```
node ${CLAUDE_SKILL_DIR}/scripts/headless-test.js \
  --port <port> \
  --message "<user question>" \
  --verbose
```

For a **multi-turn** scenario (follow-up question refers back to earlier context), pin a session
so the server-side dialog history is preserved across calls:

```
# First question — session file is created and sessionId is written into it.
node ${CLAUDE_SKILL_DIR}/scripts/headless-test.js \
  --port <port> \
  --session-file claudedocs/.agent-session \
  --message "<first question>" --verbose

# Follow-up — reuses the same sessionId from the file automatically.
node ${CLAUDE_SKILL_DIR}/scripts/headless-test.js \
  --port <port> \
  --session-file claudedocs/.agent-session \
  --message "<follow-up question>" --verbose
```

Delete `claudedocs/.agent-session` between unrelated scenario groups to avoid context bleed.

For a prepared sequence of turns, use the batch wrapper — one text file, one user message per
non-empty line (comments start with `#`):

```
node ${CLAUDE_SKILL_DIR}/scripts/headless-chat.js \
  --port <port> \
  --messages claudedocs/scenarios/<name>.txt \
  --session-file claudedocs/.agent-session \
  --out claudedocs/scenarios/<name>.out.json \
  --verbose
```

Parse the JSON response(s). For each turn check:

- `trace.tools_used` — the agent called the expected tool?
- `trace.turns[].tool_calls[].arguments` — args match what the question implies?
- `trace.turns[].tool_results[].result` — handler returned sensible data?
- `message` — final reply is accurate and useful?
- `trace.system_prompt_sent` — the prompt actually sent (useful when iterating on `AGENT_PROMPT`).

When something is off, diagnose the root cause (one of: tool description, parameter schema,
agent prompt, handler logic, error message — per `FA-MCP-SDK-DOC/08-agent-tester-and-headless-api.md`),
fix, rebuild (`yarn cb`), restart, and re-run the scenario. After restart, in-memory sessions on
the server are wiped — delete the stale `claudedocs/.agent-session` file before re-running.

Log every iteration in `claudedocs/test-log.md` in the reporting language (session header +
per-scenario: sent / expected / received / tools used / result / diagnosis / fix). This is the
audit trail.

Stop the server with `node scripts/kill-port.js <port>` (or Ctrl+C) when you're done iterating.

## Step 9 — Final quality gates

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

Write `claudedocs/dev-report.md` in the reporting language, following the structure in
`CLAUDE.md` → "Development Report" (what was built, architecture decisions, agent prompt rationale,
test coverage, Agent Tester findings, configuration, known limitations).

Alongside the full report, produce two companion files in the reporting language:

- **`claudedocs/breef-report.md`** — a brief of the work done and problems encountered. Keep it
  short and scannable (not a duplicate of `dev-report.md`): what was implemented, what passed,
  what failed, the key problems in 1–2 lines each. The same content is echoed verbatim to the
  console as part of the "Final report" step below — that is the primary way the user sees it.
- **`claudedocs/dev-problems.md`** — a focused list of what could NOT be done / tested / connected
  to during this session, plus any open questions, unresolved blockers, or decisions the user
  needs to make. Include: failed external connections (DB, upstream API, AD, Consul, etc.),
  tests that were skipped or disabled and why, missing creds, ambiguous requirements from the
  brief, anything deferred. If there are no problems, write the file anyway with a single
  "No outstanding issues." line so the user can see the check was done.

## Step 10 — Final GitLab push

The remote was created in Step 5 — do NOT re-run `gitlab-push.js` here. This step commits the
implemented feature and pushes it on top of the scaffold commit.

**1. Branch-clean check, same rule as Step 5.** Run `git status`. If there's scratch / local-only
content that shouldn't ship to the remote, stash it first:

```
git stash push -u -m "create-mcp-wizard: pre-final-push stash" -- <paths>
```

Leave anything stashed from Step 5 still stashed — if it shouldn't be in the initial commit, it
shouldn't be in this one either.

**2. Stage and commit** the implemented changes with a message that reflects what was built
(tools added, endpoints wired, etc. — not just "update"):

```
git add -A
git commit -m "<feat/fix-scoped message describing the implemented feature>"
```

If `git status` is already clean (nothing to commit after the stash), skip the commit and go
straight to step 3 — this can happen if all the work ended up in files that were already in the
initial commit and you haven't changed anything since.

**3. Push to the remote set up in Step 5:**

```
git push origin main
```

If the push is rejected because of a non-fast-forward (remote ahead) — something diverged unexpectedly.
Show the user `git log origin/main..HEAD` and `git log HEAD..origin/main` and ask how to proceed.
Do NOT `git push --force` without explicit user approval.

## Final report

Tell the user:

1. Project absolute path on disk.
2. GitLab web URL of the repo (created in Step 5) and confirmation that both the scaffold push
   (Step 5) and the feature push (Step 10) landed on `main`.
3. Summary of tools/resources/prompts/endpoints that were implemented.
4. Any flagged limitations from the dev report.
5. Links to `claudedocs/impl-plan.md`, `claudedocs/test-log.md`, `claudedocs/dev-report.md`,
   `claudedocs/breef-report.md`, `claudedocs/dev-problems.md`.
6. Anything still stashed from Step 5 / Step 10 (so the user remembers to `git stash pop` or drop).
7. **Echo the full contents of `claudedocs/breef-report.md` to the console** (in the reporting
   language, as written). This is the brief of work done + problems — it must appear inline in
   the chat, not only as a file link, so the user can read it without opening the file. If
   `claudedocs/dev-problems.md` contains anything other than "No outstanding issues.", also call
   that out explicitly and point at the file.

## Troubleshooting

**`yarn check-llm` exits non-zero with a config error** — the OpenAI key wasn't persisted into
`config/local.yaml`. Re-run Step 3 (`gen-secrets.js`) and verify the file before re-trying.

**Agent Tester returns 404 on `/agent-tester/*`** — `agentTester.enabled` is false. `gen-secrets.js`
sets it true; if still 404, rebuild (`yarn cb`) and verify `config/local.yaml` after the run.

**Headless test returns `modelConfig` errors** — the OpenAI key is wrong / out of credits / the model
name doesn't exist on the configured `baseURL`. Run `yarn check-llm` (optionally with a specific
model name) to isolate.

**GitLab push fails with 401** — token lacks `api` scope or expired. Ask for a fresh token.

**GitLab push fails with "path has already been taken"** — slug collision. Ask the user for a
different `--path` value (the URL slug, separate from `--name`).
