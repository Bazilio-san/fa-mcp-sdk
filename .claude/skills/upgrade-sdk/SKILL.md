---
name: upgrade-sdk
description: "Upgrade a downstream MCP project (built on fa-mcp-sdk) end-to-end FROM the SDK repo side: you provide a path to the target project, the skill analyzes the SDK diff between two refs LOCALLY via git, presents an actionable execution plan, gets confirmation, and applies the upgrade in the target project (deps, configs, code) — asking for any inputs inline. Falls back to a manual checklist only for items that genuinely cannot be automated. Use when user asks to upgrade/update a downstream fa-mcp-sdk project, mentions 'обнови проект', 'upgrade downstream', 'apply sdk changes to <path>', 'apply upgrade to project at <path>', or supplies a project path together with SDK versions/commits."
disable-model-invocation: true
allowed-tools: Bash(yarn *) Bash(npm *) Bash(node *) Bash(git *) Bash(cat *) Bash(diff *) Bash(ls *) Bash(find *) Bash(mkdir *) Bash(cp *) Bash(mv *) Bash(rm *) Read Write Edit MultiEdit Glob Grep Agent
argument-hint: "<target-project-path> [from-ref] [to-ref] [language hint]"
---

# FA-MCP-SDK Cross-Folder Upgrader

Execute an end-to-end upgrade of a **downstream MCP project** (built on `fa-mcp-sdk`) directly FROM the SDK repo: the
user supplies a path to the target project, this skill analyzes what changed between two SDK refs LOCALLY (via git in
the SDK repo — no GitHub API needed), presents an actionable plan, gets confirmation, then applies all changes inside
the target project. Verifies in the target, then reports.

## Operating principle

**Maximize automation.** The only items that should end up in the "manual" list are those the LLM truly cannot perform
from inside this session (production secrets, deployments to external systems, coordination with other humans). When
the LLM **can** perform a step but needs information — a credential, a config value with no sensible default, a choice
between alternatives, confirmation about overwriting a locally-customized file — it must **ask the user inline**
rather than punt the task to the manual list.

The user expects: confirm the plan → upgrade is fully done by the time the skill finishes. Failures must be reported
with concrete next-step options (retry, fix, roll back, leave-as-is) — never silently swallowed.

## Two repositories — keep them straight

- **SDK repo** — this is `process.cwd()` where the skill runs. It is the source-of-truth for the diff and is
  **read-only** during the upgrade. Never modify it.
- **Target project** — the downstream MCP server, located at the path the user provides (`<target>`). All mutations
  (config edits, file copies, `yarn add`, etc.) happen INSIDE `<target>`.

Every Bash command that mutates files must be run with `cwd = <target>` (e.g. `yarn --cwd <target> add ...`,
`cd <target> && <cmd>`, or `git -C <target> ...`). Every Read/Edit/Write tool call must use the absolute path under
`<target>/`. Every `.claude/` write in the target uses `<target>/scripts/fcp.js`.

## Workflow at a glance

```
1. Parse arguments               → target path + FROM/TO refs + language
2. Validate target + refs        → fail fast on bad path or bogus SDK refs
3. Preflight safety (target)     → branch + uncommitted-changes check IN TARGET
4. Update SDK dep in target      → form depends on how target pins fa-mcp-sdk
5. Analyze diff (LOCAL git)      → categorize every change as Auto / Needs-Input / Manual
6. Build execution plan
7. PRESENT PLAN + CONFIRM        ← blocking gate; nothing else mutates until user says go
8. Execute Auto items, ask user inline for Needs-Input items as we reach them
9. Verify IN TARGET              → lint+format+build chain, project tests, clean startup
10. Report                       → in chat + in <target>/claudedocs/upgrade-sdk-<FROM>-to-<TO>.md
```

## Step 1: Argument parsing

Parse `$ARGUMENTS` to extract: a target project path, two SDK refs (FROM, TO), and an optional language hint.

### Target path

The target path is **required**. Detect it as the first argument that:
- contains a path separator (`/` or `\`), OR
- starts with `~`, `.`, or a drive letter (`C:`, `D:`, ...), OR
- already exists as a directory in the filesystem.

Normalize to an absolute path. If no argument looks like a path, **ask the user inline**:

> "Where is the downstream MCP project I should upgrade? Provide an absolute or relative path."

Do not proceed without a valid path.

### Language detection

After stripping the target path, scan remaining arguments for a language hint:
- "на русском", "по-русски", "in Russian", "ru" → Russian
- "in English", "en" → English
- Any similar phrase or ISO 639-1 code.

**Default: English** if no hint is found. The detected language controls ALL human-readable text in the plan and the
report. Technical content (paths, YAML keys, shell commands, code snippets) stays in English regardless.

### SDK refs (FROM and TO)

After stripping the path and language hint, the remaining arguments are SDK refs. Refs always refer to **this SDK
repo's git** (tags, branches, commit hashes — verify with `git rev-parse --verify <ref>`).

- An argument is a **commit hash** if it contains 7+ hex characters and does not match semver.
- Otherwise it is a **tag/version** (`0.4.30`, `v0.4.30`, `master`, `HEAD`).
- `0.4.30` and `v0.4.30` are equivalent — try both when looking up tags.

#### Argument count for refs

**Two refs** — explicit FROM and TO.

**One ref** — it's FROM; TO defaults to `HEAD` of the SDK repo.

**No refs** — FROM defaults to the SDK version pinned in the target's `package.json` (read it; if the dep value is a
git URL, extract the commit hash; if semver with range operator, strip the operator). TO defaults to `HEAD`.

If FROM == TO, inform the user ("Both refs resolve to the same SDK commit — nothing to do") and stop.

## Step 2: Validate target and refs (fail fast)

Before any analysis or mutation:

1. **Target sanity.**
   - `<target>` must exist and be a directory.
   - `<target>/package.json` must exist.
   - It must list `fa-mcp-sdk` under `dependencies` or `devDependencies`. If not, stop with
     `<target> does not appear to be a fa-mcp-sdk-based project (no fa-mcp-sdk in package.json)`.
   - Record how the target pins fa-mcp-sdk — used in Step 4 to choose the right install command:
     - `published` — semver string like `^0.4.95`, `~0.4.95`, `0.4.95`.
     - `git-url` — value like `github:Bazilio-san/fa-mcp-sdk#<hash>` or
       `https://github.com/Bazilio-san/fa-mcp-sdk#<hash>`.
     - `local` — `file:../fa-mcp-sdk` (or similar relative/absolute path).
     - `link` — `link:../fa-mcp-sdk` (yarn link / portal).

2. **SDK refs exist locally.** Run `git rev-parse --verify <FROM>` and `git rev-parse --verify <TO>` in the SDK repo.
   On failure, report `Cannot resolve SDK ref <X>` and stop. For semver refs, try both `<X>` and `v<X>` as tag names.

3. **Display the resolution:**

```
SDK repo:      <sdk-cwd>
Target:        <target>  ✓ has fa-mcp-sdk (<pin-form>)
FROM (SDK):    <ref> → <short-hash> (<date>)  ✓ validated
TO   (SDK):    <ref> → <short-hash> (<date>)  ✓ validated
```

## Step 3: Preflight safety in the target

This is the last point before mutating the target. Run these checks and **ask the user inline** when relevant:

1. **Branch check.** `git -C <target> rev-parse --abbrev-ref HEAD`. If the target is on
   `main`/`master`/`prod`/`production`, ask:
   "Target is on `<branch>`. I recommend creating `upgrade/sdk-<TO>` there before mutating anything. Create it now?
   (yes/no)" On yes, `git -C <target> checkout -b upgrade/sdk-<TO>`. On no, proceed but flag it in the report.
2. **Uncommitted changes.** `git -C <target> status --short`. If non-empty, ask:
   "Target has N uncommitted changes. (1) stash, (2) require you to commit first, (3) proceed anyway (rollback will
   affect in-flight work). Pick one." Apply.
3. **Capture rollback info:**
   - Pre-upgrade commit in target: `git -C <target> rev-parse HEAD`
   - Prior SDK pin in target: copy the verbatim value from `<target>/package.json`
   - Target branch name

   These go into the final report's rollback section regardless of outcome.

## Step 4: Update the SDK dependency in the target

This is the first mutating action. The exact command depends on the pin form recorded in Step 2:

- **published** — the user pins a normal version. If TO is a tag like `0.4.97`, run inside the target:
  ```bash
  yarn --cwd <target> add fa-mcp-sdk@<TO-version>
  ```
  If TO is a commit hash, switch to a git URL: `yarn --cwd <target> add fa-mcp-sdk@github:Bazilio-san/fa-mcp-sdk#<TO>`.
  **Ask the user** before changing pin form ("Your target pins a published version. TO is a commit — do you want to
  switch to a git-URL pin, or should I refuse and ask for a published TO instead?").

- **git-url** — the user already pins via git URL. Update the URL to point at TO:
  ```bash
  yarn --cwd <target> add fa-mcp-sdk@github:Bazilio-san/fa-mcp-sdk#<TO-hash-or-tag>
  ```

- **local** (`file:..`) — the target consumes the SDK from a local path. Do not run `yarn add` — that would replace
  the local pin with a published version. Instead, ensure the local SDK is on the right ref (`git -C <sdk-cwd> log -1`
  to confirm the SDK repo is at TO), then run:
  ```bash
  yarn --cwd <target> install
  ```
  If TO ≠ the SDK repo's current HEAD, **ask the user**:
  "Your target uses a local file: pin to this SDK. To upgrade to TO=<ref>, this SDK repo itself must be at TO. Right
  now it's at `<sdk-HEAD>`. Options: (a) I check out `<TO>` in the SDK repo (risk: changes your local SDK state),
  (b) you do it manually and re-run, (c) abort. Pick one." Apply.

- **link** (`link:..`) — similar to `local` but via yarn link. Same logic; prefer `yarn --cwd <target> install` and
  ask before touching SDK ref.

If the install step fails, show the error verbatim and ask: retry / switch to a different TO ref / abort.

After the install succeeds, run the doc-and-template sync in the target:
```bash
node <target>/node_modules/fa-mcp-sdk/scripts/update-sdk.js
```
(use a `--cwd <target>` or `cd <target> && ...` wrapper so the script's `process.cwd()` is the target). This copies
the latest `FA-MCP-SDK-DOC/` and `.claude/` content into the target. Pinned folders (any folder under the target's
`.claude/` containing a direct file named `pin`) are preserved by the script.

## Step 5: Analyze the diff — LOCAL git

Because this skill runs in the SDK repo, do all diff analysis with **local git** — no GitHub API, no
rate-limiting, no fallbacks. Every command in this step runs with `cwd = <sdk-cwd>` (the SDK repo) unless explicitly
noted otherwise.

### 5.1 Commit log

```bash
git log --oneline <FROM>..<TO>
git log --format='%h %s%n%n%b' <FROM>..<TO>
```

Read full commit messages (subject + body) for every commit in the range. Use them to:
- Spot intent — flag any conventional-commit `BREAKING CHANGE:` markers prominently.
- Group related file changes under a single narrative.
- Note "rationale unclear — check commit `<hash>` directly" for non-obvious diffs with terse messages.

Include a "Changelog" list (short hash + first line) in the report.

### 5.2 Config files

```bash
git diff --name-only <FROM> <TO> -- config/
```

These SDK config files are mirrored downstream:

- `config/default.yaml` — main defaults
- `config/_local.yaml` — template the project's `config/_local.yaml` is derived from (CLI applies `{{param}}` subs
  to produce the project's `config/local.yaml`)
- `config/custom-environment-variables.yaml` — env var mappings
- `config/development.yaml`, `config/production.yaml` — env overrides shipped to projects
- `config/local.yaml` (SDK's own) — reference only, not shipped

For each changed config file:
```bash
git diff <FROM> <TO> -- config/<file>
```

Identify: new keys, removed keys, changed defaults, restructured sections, new env mappings.

**Correlate `default.yaml` ⇄ `_local.yaml`.** Whenever `default.yaml` has structural changes, also diff `_local.yaml`.
If `default.yaml` changed but `_local.yaml` did NOT, flag that the target's `config/_local.yaml` may need manual
updates to stay consistent.

**Config file mapping (SDK source → target destination):**

| SDK source (in `config/`)                  | Target destination                              | Action |
|--------------------------------------------|-------------------------------------------------|--------|
| `config/default.yaml`                      | `<target>/config/default.yaml`                  | Add new keys; do NOT remove existing keys the target may have customized |
| `config/_local.yaml`                       | `<target>/config/_local.yaml`                   | Update to match SDK — the template `local.yaml` is derived from |
| `config/_local.yaml` (via CLI)             | `<target>/config/local.yaml`                    | Derived by CLI from `_local.yaml` with `{{param}}` subs |
| `config/custom-environment-variables.yaml` | `<target>/config/custom-environment-variables.yaml` | Add new env var mappings |
| `config/development.yaml`                  | `<target>/config/development.yaml`              | Add new keys; do NOT remove existing keys |
| `config/production.yaml`                   | `<target>/config/production.yaml`               | Add new keys; do NOT remove existing keys |
| `config/local.yaml` (SDK's own)            | *(not shipped — reference only)*                | Reference for what the SDK itself overrides locally |

### 5.3 cli-template files

```bash
git diff --name-only <FROM> <TO> -- cli-template/
```

`cli-template/` ships the project template the CLI uses to scaffold new projects. Existing targets need patches that
match.

| Template (source of truth)                                       | Target destination                       | Notes |
|------------------------------------------------------------------|------------------------------------------|-------|
| `cli-template/package.json`                                      | `<target>/package.json`                  | **Merge carefully** — see rule below |
| `cli-template/tsconfig.json`                                     | `<target>/tsconfig.json`                 | Overwrite unless customized |
| `cli-template/.oxlintrc.json`                                    | `<target>/.oxlintrc.json`                | Overwrite unless customized |
| `cli-template/.oxfmtrc.json`                                     | `<target>/.oxfmtrc.json`                 | Overwrite unless customized |
| `cli-template/CLAUDE.md`                                         | `<target>/CLAUDE.md`                     | Merge — target may add custom sections |
| `cli-template/jest.config.js`                                    | `<target>/jest.config.js`                | Overwrite unless customized |
| `cli-template/deploy/`                                           | `<target>/deploy/`                       | Merge per file |
| `cli-template/.claude/skills/<skill>/`                           | `<target>/.claude/skills/<skill>/`       | Overwrite unless locally customized |
| `cli-template/r/<name>.xml`                                      | `<target>/.run/<name>.run.xml`           | **Renamed** — see rule below |
| `cli-template/gitignore`                                         | `<target>/.gitignore`                    | Source has no leading dot |
| `cli-template/FA-MCP-SDK-DOC/`                                   | `<target>/FA-MCP-SDK-DOC/`               | Auto-updated by `update-sdk.js` in Step 4 |

For each changed cli-template file, read its content at TO directly from the SDK working tree:
`<sdk-cwd>/cli-template/<path>` (you are already at TO if the SDK is checked out there, otherwise use
`git show <TO>:cli-template/<path>`).

#### Rule: `package.json` — ADD ONLY new dependencies

Diff the template `package.json` between FROM and TO:
```bash
git diff <FROM> <TO> -- cli-template/package.json
```
1. Identify ONLY dependencies/devDependencies that were **added** in the template (not version-changed, not removed).
2. Add them to `<target>/package.json` under the matching section. Do NOT touch `name`, `version`, `scripts`,
   `engines`, `type`, or any other field.
3. Removed deps from the template → informational only in the report; do not delete from the target.

#### Rule: `r/` → `.run/` with filename transformation

The target has no `r/` directory — the CLI renamed `cli-template/r/` to `.run/` at scaffold time, and each
`<name>.xml` to `<name>.run.xml`. For each changed file in `cli-template/r/`:
- Source: `<sdk-cwd>/cli-template/r/<name>.xml` (or `git show <TO>:cli-template/r/<name>.xml`)
- Destination: `<target>/.run/<name>.run.xml`
- NEW → copy + rename.
- CHANGED → if the target's existing `.run.xml` is untouched (matches the FROM template), overwrite. If customized,
  treat as Needs-Input (overwrite / merge / skip).
- REMOVED → informational only; do not delete the target's file.

#### Rule: `.claude/` files in the target — use the target's fcp.js

`.claude/**` is denied for direct `Write`/`Edit` in the target's `settings.json`. To update any file under
`<target>/.claude/` use the target's own `<target>/scripts/fcp.js`:
1. Write the new content to a temp file outside `.claude/` (e.g. `<target>/_tmp-skill.md`).
2. `node <target>/scripts/fcp.js <target>/.claude/<path> <target>/_tmp-skill.md`.
3. `rm <target>/_tmp-skill.md`.

(This is the same protocol the target's `edit-claude-files` skill describes — apply it from this skill too.)

For any other changed template file: SDK source path, target destination, action = overwrite or merge depending on
local customization.

### 5.4 Scripts

```bash
git diff --name-only <FROM> <TO> -- scripts/
```

The CLI copies scripts from the SDK's `scripts/` (NOT `cli-template/scripts/`) into the target's `scripts/`, then
omits `copy-static.js`, `publish.js`, and `scripts/publish-README.md` (SDK-internal).

- Canonical source: `<sdk-cwd>/scripts/<name>.js`
- Target destination: `<target>/scripts/<name>.js`
- Exclude: `copy-static.js`, `publish.js`, `publish-README.md`

For each changed (non-excluded) script, decide whether the target needs the new version. If the target's script is
unmodified vs. FROM, overwrite. If customized, treat as Needs-Input.

### 5.5 Core library exports

```bash
git diff --name-only <FROM> <TO> -- src/core/
git diff <FROM> <TO> -- src/core/index.ts
```

Inspect the diff to identify: new exports, removed/renamed exports, changed type signatures, type-level changes that
won't survive `.d.ts` emission cleanly. Working from the TypeScript source (local checkout) is always more accurate
than reading the compiled `.d.ts` — use it.

### 5.6 Target code scan

Scan `<target>/src/`, `<target>/config/`, `<target>/tests/` for:
- Imports from `fa-mcp-sdk` referencing removed/renamed exports
- Usage of deprecated APIs
- Config keys that were renamed or restructured

For each hit, capture file:line and the exact replacement plan — needed for Step 6 categorization.

## Step 6: Categorize and build the execution plan

For every change found in Step 5, assign one of three categories:

### Auto — LLM applies without asking
- Install command from Step 4 (already done)
- `update-sdk.js` run in target (already done)
- Adding a brand-new config key to `<target>/config/default.yaml` when the target doesn't override it
- Adding new env var mappings to `<target>/config/custom-environment-variables.yaml`
- Adding a missing dependency to `<target>/package.json` under `dependencies`/`devDependencies`
- Copying a new template file the target doesn't have yet (scripts, `.run/` entries, new skill folders)
- Applying a mechanical rename of a renamed SDK export across the target's `src/` when there's exactly one
  unambiguous replacement
- Updating SDK-shipped skill files in `<target>/.claude/` via the target's `fcp.js` protocol when the target hasn't
  customized them

### Needs-Input — LLM applies, but needs user input
- A locally-customized target file conflicts with the new template — ask: overwrite / merge / skip
- A new config key has no sensible default — ask for the value
- A breaking change has multiple plausible API replacements — ask which fits the target's intent
- A `BREAKING CHANGE:` marker that the LLM can apply mechanically but wants explicit confirmation
- The target's `config/local.yaml` has stale overrides for keys that changed structure — ask: drop / port to new
  structure / leave + warn
- A switch in pin form (e.g. published → git-url) — ask before doing it

### Manual — LLM cannot perform
Reserve only for things the LLM truly cannot do in this session:
- Rotating production secrets in a secrets manager outside this repo
- Deploying to staging/production environments
- Communicating with third-party services or teammates

**If a step could be automated in principle but requires human judgment, prefer Needs-Input over Manual.**

Also produce a quick **risk + effort** estimate based on the change characteristics:

- **Risk: High** — removed/renamed exports, removed config keys, changed meaning of existing keys, renamed
  `cli-template/r/<name>.xml`, changed signatures of exported functions, major dep bumps.
- **Risk: Medium** — new required config keys without sensible defaults, restructured config sections, new template
  files the target must adopt, minor dep bumps with migration notes.
- **Risk: Low** — purely additive changes (new optional keys with defaults, new exports, new template files that
  don't replace existing ones, patch dep bumps, doc updates).

- **Effort: S** (≤30 min) — Low-risk additive only.
- **Effort: M** (≈1–3 h) — config merges + a few template files, no code changes.
- **Effort: L** (≥half a day) — High-risk changes requiring code edits in the target's `src/` or restructured
  config sections to reconcile with the target's `local.yaml`.

List the **specific signals** driving the rating (e.g. "Removed export `foo` from `src/core/index.ts`", "Renamed
`auth.token` → `auth.jwt` in `default.yaml`") so the developer can verify against actual target usage.

## Step 7: Present the plan and ASK FOR CONFIRMATION

Render the plan in the conversation (in the detected language):

```markdown
## Upgrade plan — target: <target>, fa-mcp-sdk <FROM> → <TO>

**Risk:** Low / Medium / High — driven by: <list of specific signals>
**Effort:** S / M / L

### 🤖 I will do automatically (N items)
1. ✅ <install command from Step 4>                    [already done]
2. ✅ node <target>/node_modules/fa-mcp-sdk/scripts/update-sdk.js   [already done]
3. Add new key `webServer.foo` (default `bar`) to `<target>/config/default.yaml`
4. Copy new template file `<target>/.run/new-task.run.xml` (renamed from `cli-template/r/new-task.xml`)
5. Add dep `some-pkg@^1.2.3` to `<target>/package.json` `dependencies`
6. Apply rename `oldFn` → `newFn` in `<target>/src/foo.ts:42`, `<target>/src/bar.ts:17`, ...
7. Run verification in target: `npx oxlint --fix . && npx oxfmt . && npx rimraf dist && npx tsc` + project tests + clean startup

### ❓ I need your input on (M items)
1. `<target>/config/local.yaml` overrides `webServer.auth` which restructured in <TO>. Options:
   (a) port overrides to new structure  (b) drop overrides  (c) leave + warn
2. New config key `someService.apiKey` has no default. What value should I set?
3. `<target>/.claude/skills/upgrade-sdk/SKILL.md` is locally customized. Overwrite / merge / skip?

### 👋 You'll need to do manually (K items)
- [empty if everything is in Auto or Needs-Input]

### Rollback info
- Target pre-upgrade commit: <hash>
- Target branch: <branch>
- Prior SDK pin in target: <verbatim package.json value>
- SDK repo HEAD: <sdk-head-hash> (not modified by this skill)
```

Then ask **explicitly**:

> "Confirm — apply the Auto items now and prompt you inline for the Needs-Input items as I reach them? (yes/no)"

Wait for explicit confirmation. If the user declines, stop and leave the target as it is after Step 4 (note this in
the final report). If the user confirms, proceed to Step 8.

## Step 8: Execute

Apply each Auto item in order. For each Needs-Input item, ask the user **at the moment you reach it** (one question
at a time so the user can reason — don't batch). Apply with the answer, then move on.

Be transparent — after each item, output a one-line acknowledgment so the user can follow along, e.g.
`✓ Added webServer.foo to <target>/config/default.yaml`.

**Always use `<target>` paths for writes.** Never edit the SDK repo. When touching files under `<target>/.claude/`,
use `<target>/scripts/fcp.js` (see Step 5.3 → "Rule: `.claude/` files in the target").

Maintain an in-memory execution log so the final report can list exactly what was done and what required input.

## Step 9: Verify (inside the target)

After all items are applied, run the verification chain **inside the target project**. Record pass/fail for each step.

### 9.1 Lint + format + clean build (fixed chain)

Run this single command chain in the target:

```bash
cd <target> && npx oxlint --fix . && npx oxfmt . && npx rimraf dist && npx tsc
```

- `oxlint --fix .` — auto-fix lint issues across the target
- `oxfmt .` — format the target
- `rimraf dist` — wipe stale build output
- `tsc` — typecheck + compile

If any step fails, stop the chain and trigger the failure-handling flow below.

### 9.2 Project tests (whatever is wired in `<target>/package.json`)

**Do not hard-code a test command.** Read `<target>/package.json` `scripts` section and run whatever the target
actually defines. Common patterns to look for, in order of preference:

1. `test:mcp`, `test:mcp-http`, `test:mcp-sse`, `test:mcp-streamable` — MCP transport tests (run all that exist)
2. `test` — top-level test runner (usually `jest`)
3. Any other script whose name starts with `test:` or contains `test`

Run each via `yarn --cwd <target> <script>` or `cd <target> && yarn <script>`. Record pass/fail per script.

If no test scripts are defined, note it in the report ("target has no test scripts — verification skipped tests").

### 9.3 Clean startup

```bash
cd <target> && yarn start &
# wait ~3-5s for startup logs
node <target>/scripts/kill-port.js <port>   # port from <target>/config/default.yaml → webServer.port
```

"Clean startup" means: no exceptions in logs, server reports it's listening. If startup fails, treat as verification
failure.

### On verification failure

Do NOT silently proceed and do NOT silently roll back. Present the failing step, the error output, and the diff of
the likely-causing file(s), then ask the user to choose:

> "Verification failed at <step>. Options:
>  - **fix**: I diagnose the root cause and fix it (may need more input from you)
>  - **retry**: just rerun the verification step (useful for flaky tests)
>  - **rollback**: revert the target to pre-upgrade state (commit `<hash>`, SDK pin `<prior>`) and stop
>  - **leave-as-is**: keep current state, surface the failure in the final report, and stop
>  Pick one."

Apply the user's choice:
- **fix** → diagnose, apply a fix (asking inline for any info needed), re-run verification. Loop if it fails again.
- **retry** → rerun the failing step once. If it fails again, present the same four options.
- **rollback** → in the target: revert SDK pin to the verbatim prior value
  (`yarn --cwd <target> add fa-mcp-sdk@<prior-value>` for published/git-url forms, or restore `package.json` directly
  for local/link forms), `git -C <target> checkout <pre-upgrade-hash> -- .`, then re-run
  `node <target>/node_modules/fa-mcp-sdk/scripts/update-sdk.js` if needed. If the user stashed changes in Step 3,
  restore them with `git -C <target> stash pop`. Report what was rolled back.
- **leave-as-is** → no further changes. Final report will clearly mark the failure and what remains unverified.

## Step 10: Report

Produce a final report in **two places**:
1. **In the chat**, immediately at the end of the skill run.
2. **In a file** at `<target>/claudedocs/upgrade-sdk-<FROM>-to-<TO>.md` (overwrite if it exists from a previous run).

Make sure `<target>/claudedocs/` exists (`mkdir -p <target>/claudedocs`) before writing.

Both copies use this structure (in the detected language):

```markdown
# Upgrade report — target: <target>, fa-mcp-sdk <FROM> → <TO>

Generated: <ISO timestamp>
SDK repo:  <sdk-cwd>
Target:    <target>
Branch (target): <branch>
Pre-upgrade commit (target): <hash>
Prior SDK pin: `<verbatim package.json value>`

## Outcome

<one of: ✅ completed | ⚠️ completed with issues | ❌ rolled back | ⏸ stopped at user request>

## Risk & effort

- Risk: Low / Medium / High — signals: <list>
- Effort: S / M / L

## Changelog (commits between FROM and TO)

- `<short-hash>` <first line>
- ...

## ✓ Done automatically

- Item 1
- ...

## ✓ Done with your input

- `<target>/config/local.yaml`: chose (a) port to new structure — applied N keys
- `someService.apiKey`: set to `<value-you-provided>`
- `oldFn` → `newFn` rename: applied to <target>/src/foo.ts:42, ...
- ...

## 👋 Still on your plate

- [empty if nothing manual remains]

## Verification (in target)

- `oxlint --fix .`:            ✅ / ❌ (<error excerpt>)
- `oxfmt .`:                   ✅ / ❌
- `rimraf dist`:               ✅ / ❌
- `tsc`:                       ✅ / ❌ (<error excerpt>)
- tests (<list scripts run>):  ✅ / ❌ (<n>/<m> passed)
- clean startup:               ✅ / ❌

## Rollback info

- Target pre-upgrade commit: `<hash>`
- Prior SDK pin: `<verbatim value>`
- To roll back manually:
  ```bash
  # restore package.json pin
  yarn --cwd <target> add fa-mcp-sdk@<prior-pin>     # or restore <target>/package.json directly for file:/link: pins
  git -C <target> checkout <hash> -- .
  node <target>/node_modules/fa-mcp-sdk/scripts/update-sdk.js
  ```

## Notes

<anything noteworthy: pin-form switches, files with rationale-unclear diffs flagged for review, etc.>
```

## Important rules

- The SDK repo (`<sdk-cwd>`) is **read-only** during the upgrade. Never edit it.
- Always read actual files; never guess what changed. Local `git diff` is authoritative — use it.
- Treat target customizations as inviolable unless the user explicitly says "overwrite" in response to a Needs-Input
  prompt.
- Never modify `<target>/package.json` other than to (a) bump the `fa-mcp-sdk` pin in Step 4 and (b) ADD new deps from
  the cli-template diff. Do not change `name`, `version`, `scripts`, `engines`, `type`, etc.
- Don't skip verification. If it fails, surface it via the 4-option prompt — don't smuggle failures past the user.
- All `<target>/.claude/` writes go through `<target>/scripts/fcp.js`.
- Write all human-readable text in the detected language (default: English). Keep paths, YAML keys, and shell
  commands in English regardless.
- Correlate config files: when `default.yaml` changes, always check `_local.yaml` for analogous changes and flag
  stale `local.yaml` overrides in the target explicitly.
- For local/link SDK pins: never replace the pin with a published version without explicit user consent — that
  silently breaks the dev workflow.
