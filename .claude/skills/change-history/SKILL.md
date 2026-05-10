---
name: change-history
description: "Record a compact, anonymized upgrade-step guide that summarizes what changed in fa-mcp-sdk between two commits. Stored under change-history/ as a checkpoint chain. Use when user asks to record/track SDK changes for downstream MCP projects, mentions 'change-history', 'зафиксировать изменения SDK', 'компактная инструкция по обновлению SDK', or wants to collapse multiple history files into one."
disable-model-invocation: true
argument-hint: "[from-commit] [to-commit] [language]  |  collapse <file1> <file2> [...] [language]"
allowed-tools: Bash(git *) Bash(node *) Bash(ls *) Bash(rm *) Bash(mkdir *) Read Write Glob Grep
---

# fa-mcp-sdk Change-History Recorder

Generate a **compact, anonymized** upgrade-step guide for downstream MCP projects that were
generated from this SDK. Guides are stored in `change-history/` and form a chain of checkpoints —
each new guide picks up from where the previous one ended.

This is a sibling to `/upgrade-guide`, but the output must be **substantially shorter** —
think changelog entry, not full migration document. No verbose templates, no risk-assessment
sections, no impact analysis. List what changed, flag config/breaking impact, done.

## Audience and Perspective

The generated guide is read **inside a downstream MCP project** that was scaffolded from this SDK.
It is **not** a SDK changelog. Frame everything from the MCP author's standpoint: what they will
see in their own project after upgrading `fa-mcp-sdk` and re-running the sync command.

Downstream MCPs upgrade via:

```bash
npm i fa-mcp-sdk@latest
node node_modules/fa-mcp-sdk/scripts/update-sdk.js
```

`scripts/update-sdk.js` (in this SDK repo) defines exactly what propagates into the MCP. Currently
it copies **only**:

- `cli-template/FA-MCP-SDK-DOC/**` → `<mcp>/FA-MCP-SDK-DOC/**`
- `cli-template/.claude/**` → `<mcp>/.claude/**`, **preserving** `.claude/settings.json` and any
  folder that contains a `pin` file.

Everything else under `cli-template/` (e.g. `cli-template/package.json`, `cli-template/r/`,
`cli-template/src/`, …) is used **only** by `fa-mcp create` when scaffolding a fresh project. It
**does not reach existing MCPs** and must be silently ignored by this skill.

## Two Modes

The first positional token decides the mode:

- **`collapse`** as first token → **Collapse mode**: merge several existing history files into one.
- **anything else** (or empty) → **Record mode**: generate a new guide from a git diff.

## Argument Parsing

### Language detection (both modes)

Look for a natural-language phrase anywhere in the arguments — `на русском`, `по-русски`,
`in Russian`, `ru`, `in English`, `en`, or any similar phrase / ISO 639-1 code. Strip the hint
from the arguments before further parsing. **Default: English.**

The detected language drives every human-readable line in the generated guide. File paths,
YAML keys, code blocks, shell commands, commit hashes stay in English regardless.

### Record mode arguments

After stripping the language hint, remaining tokens are commit hashes (7+ hex chars):

| Args | FROM | TO |
|---|---|---|
| **none** | TO commit of the **latest existing guide** in `change-history/` | tip of `master` |
| **one** (`<hash>`) | `<hash>` | tip of `master` |
| **two** (`<from> <to>`) | `<from>` | `<to>` |

If `change-history/` is empty AND no FROM was supplied, ask the user to provide at least a FROM
commit and stop — there's no checkpoint to resume from.

### Collapse mode arguments

```
collapse <file1>.md <file2>.md [<file3>.md ...] [language hint]
```

At least **two** file names are required. Files may be given as bare names
(`changes-from-0.4.61-to-0.4.65.md`) or as paths relative to repo root
(`change-history/changes-from-0.4.61-to-0.4.65.md`). Resolve to absolute paths
under `change-history/`. If any file is missing, report and stop.

## Record Mode — Workflow

### Step 1: Resolve FROM commit

If FROM was not supplied:

```bash
ls -1 change-history/*.md 2>/dev/null
```

If no files exist, stop with `No previous checkpoint in change-history/. Provide a FROM commit hash explicitly.`

Otherwise, find the **latest** guide. Each guide name encodes versions
(`changes-from-<a>-to-<b>.md`). Sort by the `to-<b>` segment using semver semantics
(split on dots, compare numerically). The file with the highest `<b>` is the latest. Read its
header — it contains:

```
- To commit: <hash>
```

That hash becomes the new FROM.

### Step 2: Resolve TO commit

If TO was not supplied: `git rev-parse master` (or `origin/master` if `master` is behind —
use whichever is later). Display the resolved hash.

### Step 3: Validate refs and check for empty diff

```bash
git rev-parse --verify <FROM>
git rev-parse --verify <TO>
```

If either fails, stop with a clear error. If `git diff --quiet <FROM> <TO>` succeeds (no diff),
stop with `No changes between <FROM> and <TO> — nothing to record.`

### Step 4: Resolve fa-mcp-sdk versions for filename

Read `package.json` at each commit and extract `version`:

```bash
git show <FROM>:package.json
git show <TO>:package.json
```

Parse the JSON to get the `version` field (use `node -e "console.log(require('./package.json').version)"`
on a temp checkout, or grep `"version"` from the `git show` output). Call them `<FROM-VER>` and
`<TO-VER>` (e.g. `0.4.61`, `0.4.72`).

If `<FROM-VER>` equals `<TO-VER>`, still proceed but warn the user — multiple guide files at the
same version pair should be avoided; suggest using `collapse` later if duplicates appear.

The output filename is **always** `change-history/changes-from-<FROM-VER>-to-<TO-VER>.md`.
If the file already exists, ask the user: overwrite, or pick a different range?

### Step 5: Gather diff data

Run these in parallel and keep the results compact:

```bash
git diff --name-status <FROM> <TO>            # changed files with A/M/D status
git log --oneline <FROM>..<TO>                # commit messages
git diff <FROM> <TO> -- config/               # config diffs (full)
git diff <FROM> <TO> -- src/core/index.ts     # public exports diff
```

### Step 6: Detect special change classes

Walk the changed files list and tag each into at most one bucket. **Skip rules apply first** —
files matching any skip rule are dropped entirely (not listed, not counted).

**Skip rules** (drop the file from the report):

- `cli-template/**` outside `cli-template/FA-MCP-SDK-DOC/` and `cli-template/.claude/` —
  scaffolding-only, never reaches existing MCPs.
- `cli-template/.claude/settings.json` — preserved by `update-sdk.js`, never overwritten.
- `cli-template/.claude/**` paths whose ancestor folder contains a `pin` file — preserved by
  `update-sdk.js`. (Check the SDK working tree at TO commit for `pin` markers.)
- Root `package.json` whose diff touches **only** the top-level `version` field — implicit from
  the SDK version bump.
- Any `package.json` whose diff touches **only** the `version` field and/or
  `dependencies.fa-mcp-sdk` / `devDependencies.fa-mcp-sdk` pin — implicit from running
  `npm i fa-mcp-sdk@latest`.
- The SDK's own meta files irrelevant to consumers: `package-lock.json`,
  `tsconfig.json` changes that don't affect emitted types, `scripts/copy-static.js`,
  `scripts/publish.sh`.
- SDK-internal tooling that never ships to MCPs: `.claude/**` at the SDK repo root (this is the
  SDK developer's tooling — not the same as `cli-template/.claude/**`), `change-history/**`,
  `docs/**`, `tests/**`, `README.md`, `LICENSE`, `.gitignore`.

**Buckets** (after skip rules):

| Bucket | Match | Treatment |
|---|---|---|
| **Config** | path starts with `config/` | inline diff highlight in Configuration section; render keys the MCP author will mirror in their own `config/*.yaml` |
| **MCP-synced docs** | path starts with `cli-template/FA-MCP-SDK-DOC/` | list with destination path `FA-MCP-SDK-DOC/<rest>` (drop the `cli-template/` prefix) |
| **MCP-synced .claude** | path starts with `cli-template/.claude/` (after skip rules) | list with destination path `.claude/<rest>` |
| **Core public API** | path is `src/core/index.ts` or matches `src/core/**/*.ts` re-exported through it | feed into the Breaking Changes detection below |
| **Core internals** | other `src/core/**` | one-liner only; relevant only if the MCP imports the symbol directly |
| **Other** | anything else not skipped | one-liner only, no special section |

**Breaking change signals** (any one triggers the ⚠️ Breaking Changes section):

- A line removed (`-`) from `src/core/index.ts` `export` statements (a removed/renamed export).
- A removed key from `config/default.yaml` or `config/_local.yaml` (renamed counts as removed +
  added — note both). Frame the action as "remove/rename the key in your own MCP config".
- A commit message containing `BREAKING CHANGE`, `BREAKING:`, `breaking change`, or starting with
  `feat!:` / `fix!:` (conventional-commit breaking marker).

### Step 7: Generate the compact guide

Write **only** these sections; omit any section whose body would be empty:

```markdown
# Changes: <FROM-VER> → <TO-VER>

- **From commit:** `<FROM>` (v<FROM-VER>)
- **To commit:** `<TO>` (v<TO-VER>)
- **Generated:** <YYYY-MM-DD>
- **Commits in range:** <N>

## Summary

<1–3 sentences distilled from commit messages — what theme of changes happened.
No marketing language. State facts.>

## Changed Files

<Flat bulleted list. Group by bucket order:
Config → MCP-synced docs → MCP-synced .claude → Core public API → Core internals → Other.
One line per file: `- [A|M|D] <path-as-seen-in-MCP> — <very brief reason if non-obvious>`.
For MCP-synced buckets the path is the destination inside the MCP (no `cli-template/` prefix).
Skip the reason if the path is self-explanatory. Files dropped by Step 6 skip rules do not
appear here.>

## ⚠️ Breaking Changes

<Only if Step 6 found signals. For each:
- What changed (one line)
- Action required in the MCP project (one line, imperative — addressed to the MCP author)
Skip rationale — that's what /upgrade-guide is for.>

## 🔧 Configuration Changes

<Only if config/ files changed. For each changed key:
- `path.to.key` — added | removed | default changed `old → new`
Group by file. No prose. The MCP author mirrors these keys into their own `config/*.yaml`.>

## Commits

<Bulleted list of `<short-hash> <commit subject>` in chronological order. No bodies.>
```

Hard limits to keep the output compact:

- Total file size: aim ≤ 150 lines, hard cap 300.
- Summary: max 3 sentences.
- No tables of risk/effort/impact.
- No "Recommendations" section.
- No echo of the full git diff — only the distilled facts.

If the diff is genuinely too large to fit (e.g. a major refactor across 100+ files), still emit
the file but add a single line at the top:

```markdown
> **Note:** Large diff. For full per-file analysis use `/upgrade-guide <FROM> <TO>`.
```

### Step 8: Write the file and report

```bash
mkdir -p change-history
```

Write `change-history/changes-from-<FROM-VER>-to-<TO-VER>.md`. Then report to the user:

- Path of the new guide.
- One-line summary (e.g. `3 config keys added, 1 breaking export removed, 12 files changed`).
- The next checkpoint hash that future runs will resume from (= TO commit).

## Collapse Mode — Workflow

Used to merge a sequence of consecutive history files into a single integrated guide.

### Step 1: Validate inputs

- Resolve all file arguments to absolute paths under `change-history/`.
- Ensure each exists; if not, stop.
- Read each file's header — extract `From commit`, `To commit`, `From version`, `To version`.

### Step 2: Determine span

- **Earliest FROM commit** = the FROM of the file whose `From commit` is earliest in git ancestry.
  Use `git merge-base --is-ancestor <a> <b>` to compare commit ancestry. The "earliest" is the one
  that is an ancestor of all others.
- **Latest TO commit** = the TO of the file whose `To commit` is latest in git ancestry — i.e.
  every other listed `To commit` is its ancestor.
- If the inputs don't form a contiguous chain (gaps in the history), warn the user but proceed —
  the integrated guide covers the union of changes between earliest FROM and latest TO regardless
  of intermediate guides.
- Compute `<FROM-VER>` and `<TO-VER>` from those commits exactly as in Record Mode Step 4.

### Step 3: Generate the integrated guide

Run Record Mode Steps 5–7 with the resolved earliest-FROM and latest-TO. The output is a
**single new file** with the same compact format as a regular Record Mode output. Do **not**
concatenate the old files' bodies — re-derive the summary, changed files, breaking changes, and
config changes from the actual git diff over the wider span.

The new file's name follows the same convention:
`change-history/changes-from-<FROM-VER>-to-<TO-VER>.md`.

If a file with that name exists and is **not** one of the inputs being collapsed, ask the user
how to proceed (overwrite, choose different range, abort).

### Step 4: Delete the old files and report

After successfully writing the new integrated guide:

```bash
rm change-history/<file1>.md change-history/<file2>.md ...
```

Only delete the files passed as inputs — never anything else. Report:

- Path of the new integrated guide.
- List of removed files.
- Summary line as in Record Mode.

## Header format — read and write contract

The header is **load-bearing**. Future runs of this skill (and the collapse command) parse it.
Always emit exactly these lines, in this order, immediately after the H1:

```
- **From commit:** `<full-or-short-hash>` (v<from-version>)
- **To commit:** `<full-or-short-hash>` (v<to-version>)
- **Generated:** <YYYY-MM-DD>
- **Commits in range:** <N>
```

When parsing existing files, accept both backticked and bare hashes, and either short (7+ hex)
or full (40 hex) form.

## Important Rules

- **Output language**: detected language for prose; English for paths/keys/commands/hashes.
- **Output is anonymized**: no references to any specific downstream project. Address the reader
  as "the MCP project" / "your MCP" / "the MCP author".
- **MCP perspective, not SDK perspective**: list paths as the MCP author will see them in their
  own checkout. For `cli-template/FA-MCP-SDK-DOC/**` and `cli-template/.claude/**` files, drop the
  `cli-template/` prefix. For all other `cli-template/**` files, drop them entirely (scaffolding-
  only, never propagated by `update-sdk.js`).
- **Skip noise**: never list `package.json` if its only diff is `version` and/or the
  `fa-mcp-sdk` dependency pin — that change is implicit when the MCP runs `npm i fa-mcp-sdk@latest`.
- **Be specific, be short**: each bullet ≤ 1 line. No paragraphs in Changed Files / Config /
  Breaking Changes sections.
- **Don't duplicate `/upgrade-guide`**: if the user wants verbose migration steps, point them
  at `/upgrade-guide`.
- **Never modify project files** other than creating/removing files in `change-history/`.
- **Never delete a file** in collapse mode that wasn't explicitly listed in the input arguments.
- **Filename uses versions, header uses commit hashes** — the two layers must always agree.
