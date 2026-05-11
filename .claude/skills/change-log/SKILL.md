---
name: change-log
description: "Generate a CHANGELOG.md entry for fa-mcp-sdk covering the range from the last version listed in CHANGELOG.md up to the current package.json version, or up to an explicitly-specified TO version. Includes only substantial changes (features, API, config, fixes, breaking changes) — cosmetic/style commits are filtered out. Use when the user asks to update CHANGELOG.md, generate a changelog, 'обновить changelog', 'сгенерировать changelog', or '/change-log'."
disable-model-invocation: true
argument-hint: "[to-version]"
allowed-tools: Bash(git *) Bash(node *) Bash(cat *) Bash(ls *) Read Write Edit Grep Glob
---

# fa-mcp-sdk CHANGELOG Generator

Generate a new CHANGELOG.md entry covering changes between the **last version recorded in
CHANGELOG.md** and either the **current package.json version** or an **explicitly-specified TO
version**. Only **substantial** changes are included; cosmetic/style/internal-tooling churn is
filtered out.

The CHANGELOG.md lives at the repo root and follows the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format with sections
`Added` / `Changed` / `Fixed` / `Removed` / `Breaking`.

## Argument Parsing

`$ARGUMENTS` is optional. If supplied, the first token must be a semver string `X.Y.Z` and is
treated as the **TO version**. Anything that doesn't match `^\d+\.\d+\.\d+$` is ignored.

| Args | FROM-VER | TO-VER |
|---|---|---|
| **none** | latest version in `CHANGELOG.md` | `package.json` `version` field |
| **one** `X.Y.Z` | latest version in `CHANGELOG.md` | `X.Y.Z` |

## Workflow

### Step 1: Resolve FROM-VER from CHANGELOG.md

Read `CHANGELOG.md` at repo root. Find all version headings matching the regex:

```
^##\s+\[?(\d+\.\d+\.\d+)\]?
```

The **first** match (top-most in the file) is the latest version recorded.

### Step 2: Resolve TO-VER

- If `$ARGUMENTS` contains a `X.Y.Z` token: `TO-VER` = that token.
- Otherwise: read `package.json` `version` field via
  `node -e "console.log(require('./package.json').version)"`.

If `FROM-VER == TO-VER`, stop with `No new version to record — CHANGELOG.md is up to date with v<VER>.`

### Step 3: Resolve commit hashes for FROM-VER and TO-VER

For each version, find the commit that **bumped** the project to it. The SDK convention is that
version-bump commits have the version string as the entire commit subject (e.g. subject `0.4.84`).

```bash
git log --format="%H %s" | awk -v v="<VER>" '$2 == v { print $1; exit }'
```

Fallback if the above returns nothing — find the first commit where `package.json` `version` was
set to that value:

```bash
git log --reverse --format="%H" -S "\"version\": \"<VER>\"" -- package.json | head -1
```

If `FROM-VER` cannot be resolved to a commit (e.g. it's older than the repo's first commit),
use the repo's first commit (`git rev-list --max-parents=0 HEAD | head -1`) as `FROM-COMMIT` and
note this in the output.

If `TO-VER` equals current `package.json` version and no version-bump commit exists yet for it,
use `HEAD` as `TO-COMMIT`.

### Step 4: Gather diff data

Run in parallel:

```bash
git log --format="%H|%s|%b---END---" <FROM-COMMIT>..<TO-COMMIT>   # full commit messages
git diff --name-status <FROM-COMMIT> <TO-COMMIT>                  # changed files
git diff <FROM-COMMIT> <TO-COMMIT> -- config/                     # config diffs (full)
git diff <FROM-COMMIT> <TO-COMMIT> -- src/core/index.ts           # public exports diff
git diff <FROM-COMMIT> <TO-COMMIT> -- src/_types_/ src/core/_types_/  # type signature changes
```

### Step 5: Filter to substantial changes

Walk the commit list and classify each commit. **Drop** a commit entirely if **all** of the
following hold:

- Its subject matches one of these patterns (case-insensitive):
  - `^chore: format`, `^chore: lint`, `^style:`, `^chore: prettier`, `printWidth`
  - `^chore: typo`, `^docs: typo`, `^chore: whitespace`, `^chore: comments?`
  - `^chore: rename .* (variable|local)`, `^chore: reorder imports`
  - bare version-bump subjects: `^\d+\.\d+\.\d+$`
  - `^chore: bump`, `^chore: release`
- Its diff touches **only** files that are themselves cosmetic-only:
  - Whitespace / formatting changes (no logic delta)
  - Comment-only edits
  - `*.md` files that are not user-facing docs (e.g. internal notes)

If in doubt, **keep** the commit — readers can skim past a borderline entry, but a missing real
change is harder to recover.

Additionally drop these path classes from consideration entirely (their changes don't go into
the changelog regardless of commit grouping):

- `package-lock.json`, `tsconfig.json` (unless it affects emitted types),
  `.gitignore`, `.editorconfig`, `.prettierrc*`, `.oxlintrc*`
- `change-history/**`, `CHANGELOG.md` itself
- `scripts/copy-static.js`, `scripts/publish.js`, `scripts/publish-README.md`
- `tests/**` (test-only changes — internal quality, not user-visible)
- Root `package.json` if its only diff is the `version` field

### Step 6: Classify remaining commits into sections

For each surviving commit, decide which CHANGELOG section it belongs to:

| Section | Signals |
|---|---|
| **Breaking** | Removed export from `src/core/index.ts`; removed/renamed config key in `config/default.yaml`; commit message contains `BREAKING CHANGE`, `BREAKING:`, or starts with `feat!:` / `fix!:` |
| **Added** | New export in `src/core/index.ts`; new file in `src/core/**`; commit subject starts with `feat:` / `feat(...)` / `add:` |
| **Changed** | Behavior change without API removal; modified config key with new default; commit subject starts with `refactor:`, `perf:`, `change:`, or describes a behavior change |
| **Fixed** | Commit subject starts with `fix:` / `fix(...)`, or describes a bug fix |
| **Removed** | Deleted file in `src/core/**`; removed export (also goes under Breaking) |

A single commit may legitimately appear in more than one section if it does multiple things;
prefer placing it in the **most impactful** section (Breaking > Removed > Added > Changed > Fixed).

### Step 7: Format the new entry

Use this template. Omit any section whose body would be empty.

```markdown
## [<TO-VER>] - <YYYY-MM-DD>

### Breaking

- <one-line description, imperative voice, addressed to the SDK consumer>

### Added

- <one-line description>

### Changed

- <one-line description>

### Fixed

- <one-line description>

### Removed

- <one-line description>
```

Rules for bullets:

- One sentence per bullet, ≤ 120 chars.
- Imperative or declarative voice, no marketing language ("blazingly fast", "magnificent", etc.).
- No commit hashes in bullets — the section heading and date locate them in git history.
- Group related commits into a single bullet when they form one logical change.
- Reference public API names verbatim (e.g. `initMcpServer`, `appConfig.webServer.genJwtApiEnable`)
  when the change affects those names — consumers grep for them.
- For config changes, write `config.path.to.key` style references.

### Step 8: Write the entry into CHANGELOG.md

Insert `<NEW-ENTRY>` **immediately above the first existing `## [` heading**, preserving the
file's existing header and trailing entries. If no existing `## [` heading is present, append
after the existing header (separated by one blank line).

Use `Edit` on CHANGELOG.md (the file is at repo root, not under `.claude/`, so direct editing is
allowed).

### Step 9: Report

Output to the user:

- The version range covered: `<FROM-VER> → <TO-VER>`.
- The commit range: `<FROM-COMMIT-SHORT>..<TO-COMMIT-SHORT>`.
- A summary line: `<N> commits considered, <M> substantial entries recorded across
  <K> sections`.
- Path of the modified file: `CHANGELOG.md`.

## Important Rules

- **Substantial only**: cosmetic, formatting, linting, test-only, and packaging churn never
  appear in the changelog. When unsure, keep — but a long list of "Fixed: typo" entries is a
  signal the filter is too lenient.
- **MCP consumer perspective**: the audience is downstream MCP authors using `fa-mcp-sdk`.
  Frame entries as what they will observe / need to do after upgrading. Internal refactors that
  don't change public API can still be relevant (e.g. perf improvements) — phrase as
  observable effect.
- **Filename references stay in English**: paths, config keys, API names, commit hashes are
  always in English regardless of any prose language preference.
- **Do not modify any file other than `CHANGELOG.md`**.
- **Do not delete or rewrite existing CHANGELOG.md entries** — only insert the new one.
- **FROM is always derived from CHANGELOG.md**, never from arguments. The TO version is the only
  user-controllable input.
- **Idempotency**: if invoked twice in a row with no new commits between, Step 2's
  `FROM-VER == TO-VER` check stops the run cleanly. Never write a duplicate header for the same
  version.
