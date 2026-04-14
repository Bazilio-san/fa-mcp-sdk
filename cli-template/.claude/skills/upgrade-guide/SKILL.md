---
name: upgrade-guide
description: "Generate a migration guide for upgrading fa-mcp-sdk to the latest version. Use when user asks to upgrade/update fa-mcp-sdk, mentions 'обновить sdk', 'upgrade sdk', 'migration guide', 'обновление fa-mcp-sdk', or wants to see what changed between SDK versions."
disable-model-invocation: true
allowed-tools: Bash(yarn *) Bash(npm *) Bash(node *) Bash(git *) Bash(cat *) Bash(diff *) Bash(ls *) Bash(find *) Bash(mkdir *) Read Write Glob Grep WebFetch Agent
argument-hint: "[from-version] [to-version] [language hint]"
---

# FA-MCP-SDK Upgrade Guide Generator

Generate a comprehensive migration guide for upgrading the fa-mcp-sdk dependency in the current project.

## Overview

This skill analyzes the differences between the currently installed version of `fa-mcp-sdk` and the latest (or specified) version, then produces a detailed migration guide as a markdown file.

## Argument Parsing

Parse `$ARGUMENTS` to extract a target version and an optional language hint.

### Language detection

Look for a natural-language phrase anywhere in the arguments that indicates the desired output language. Examples:
- "на русском", "по-русски", "in Russian", "ru" → Russian
- "in English", "en" → English
- Any similar phrase or ISO 639-1 code

Remove the language hint from the arguments before parsing the target version.

**Default: English** if no language hint is found.

The detected language determines ALL human-readable text in the generated guide (headings, descriptions, recommendations).
Technical content (file paths, YAML keys, code snippets, commands) stays as-is regardless of language.

### Version/commit references

After stripping the language hint, the remaining arguments are version or commit references.

An argument is a **commit hash** if it contains 7+ hex characters and does not match semver pattern.
Otherwise it is treated as a **version** (with or without `v` prefix — `0.4.30` and `v0.4.30` are equivalent).

#### Scope of references: PROJECT (default) vs SDK

**By default, all versions and commit hashes refer to THIS project** (the repository where the skill is invoked), NOT to fa-mcp-sdk.

A reference is treated as referring to **fa-mcp-sdk** ONLY if the user's phrasing explicitly says so. Trigger phrases for SDK scope (case-insensitive, English or Russian):
- "sdk", "fa-mcp-sdk", "of sdk", "sdk commit", "sdk version"
- "sdk", "fa-mcp-sdk", "версия sdk", "комит sdk", "коммит sdk", "хеш sdk"

Examples:
- `/upgrade-guide 1.2.3 1.2.7` → project versions (look up which SDK version was used in each)
- `/upgrade-guide от версии 0.2.3 SDK до 0.4.5 SDK` → SDK versions directly
- `/upgrade-guide от комита sdk abc1234 до комита sdk def5678` → SDK commits directly
- `/upgrade-guide abc1234 def5678` → project commits (look up which SDK version was pinned in each)

#### Resolving PROJECT references to SDK versions

When a reference is PROJECT-scoped (the default), resolve it to an SDK version/commit before computing the diff:

1. **Project commit hash** — run `git show <hash>:package.json` and extract the `fa-mcp-sdk` dependency value.
2. **Project version** (e.g. `1.2.3`) — find the project git tag (`v1.2.3` or `1.2.3`), then `git show <tag>:package.json` and extract the `fa-mcp-sdk` value.
3. If the dependency value is a semver (e.g. `^0.4.30`, `~0.4.30`, `0.4.30`), strip range operators to get the exact SDK version.
4. If the dependency value is a git URL with a commit hash (e.g. `github:Bazilio-san/fa-mcp-sdk#abc1234`), extract the commit hash as the SDK ref.
5. If the project tag/commit cannot be found, report an error and stop.

Show the user the resolution result before proceeding:
```
Resolved project references to SDK:
  FROM: project <ref> → SDK <version-or-commit>
  TO:   project <ref> → SDK <version-or-commit>
```

#### Argument count

**Two arguments** — explicit FROM and TO (resolved per scope rules above).

**One argument** — it is treated as **FROM**; TO defaults to the **latest published fa-mcp-sdk version** (fetched via `yarn info fa-mcp-sdk version` / `npm view fa-mcp-sdk version`). The point is to upgrade to the newest existing SDK release.

**No arguments** — FROM is the current installed SDK version (from the project's current `package.json`); TO is the latest published SDK version.

## Step 1: Determine SDK Versions

1. Read the current project's `package.json` and extract the installed `fa-mcp-sdk` version — this is the **default FROM (SDK)**.
2. Run `yarn info fa-mcp-sdk version` (or `npm view fa-mcp-sdk version`) to get the latest published version — this is the **default TO (SDK)**.
3. Apply argument parsing rules above (scope, count) to determine FROM and TO.
4. If any argument is PROJECT-scoped, resolve it to an SDK version/commit by reading the project's git history (see "Resolving PROJECT references to SDK versions").
5. If FROM-SDK equals TO-SDK — inform the user (e.g. "Both project commits pin the same SDK version X.Y.Z — nothing to diff") and stop.

Display to the user:
```
From: <project or SDK ref> → SDK <version-or-commit>
To:   <project or SDK ref> → SDK <version-or-commit>
```

## Step 2: Upgrade the Dependency

If TO is a published version (not a commit hash), run:
```bash
yarn add fa-mcp-sdk@<TO-version>
```

If TO is a commit hash, run:
```bash
yarn add fa-mcp-sdk@https://github.com/Bazilio-san/fa-mcp-sdk#<TO-commit>
```

Wait for completion. If it fails, report the error and stop.

## Step 3: Update SDK Documentation

Run:
```bash
node ./node_modules/fa-mcp-sdk/scripts/update-doc.js
```

This copies the latest `FA-MCP-SDK-DOC/` from the SDK into the project.

## Step 4: Analyze Changes in SDK Between Versions

Use the public GitHub repository `https://github.com/Bazilio-san/fa-mcp-sdk` to analyze what changed.

### 4.1 Get the commit log between versions

Fetch the GitHub compare URL to understand what changed:

```
https://api.github.com/repos/Bazilio-san/fa-mcp-sdk/compare/<FROM-ref>...<TO-ref>
```

Where `<FROM-ref>` and `<TO-ref>` are version tags (try both `v0.4.30` and `0.4.30` formats) or commit hashes.

If version tags don't exist, use the commits API to find commits between versions, or search `git log` for version bump commit messages.

Alternative approach — use the npm registry to get git metadata, or simply read the changelog if available.

### 4.2 Analyze changes in config files

These config files in the SDK may have changed and require corresponding updates in the project:

- `config/default.yaml` — main configuration defaults
- `config/custom-environment-variables.yaml` — env var mappings
- `config/development.yaml` — dev overrides
- `config/production.yaml` — production overrides
- `config/local.yaml` — local secrets template

For each config file, compare the SDK's version (at `node_modules/fa-mcp-sdk/config/<file>`) with the project's version (at `config/<file>`).

Identify:
- **New keys** added in the SDK that are missing in the project
- **Removed keys** that existed in the old SDK but are gone now
- **Changed defaults** where the SDK's default value has changed
- **New sections** that represent new features

### 4.3 Analyze changes in cli-template files

The SDK ships a project template at `node_modules/fa-mcp-sdk/cli-template/` (after `yarn add fa-mcp-sdk@<TO>`). This is the **canonical source** for any template files in the project — when generating instructions for the user, always point to this path as the place to copy the latest version from.

Map of template file → project file (the CLI `bin/fa-mcp.js` applies these transformations when creating new projects — upgrades must respect the same mapping):

| Template (source of truth)                                        | Project (destination)                       | Notes |
|-------------------------------------------------------------------|---------------------------------------------|-------|
| `node_modules/fa-mcp-sdk/cli-template/package.json`               | `package.json`                              | **Merge carefully** — see rule below |
| `node_modules/fa-mcp-sdk/cli-template/tsconfig.json`              | `tsconfig.json`                             | overwrite (unless customized) |
| `node_modules/fa-mcp-sdk/cli-template/eslint.config.js`           | `eslint.config.js`                          | overwrite (unless customized) |
| `node_modules/fa-mcp-sdk/cli-template/CLAUDE.md`                  | `CLAUDE.md`                                 | merge — project may add custom sections |
| `node_modules/fa-mcp-sdk/cli-template/jest.config.js`             | `jest.config.js`                            | overwrite (unless customized) |
| `node_modules/fa-mcp-sdk/cli-template/deploy/`                    | `deploy/`                                   | merge per file |
| `node_modules/fa-mcp-sdk/cli-template/.claude/skills/<skill>/`    | `.claude/skills/<skill>/`                   | overwrite unless locally customized |
| `node_modules/fa-mcp-sdk/cli-template/r/<name>.xml`               | `.run/<name>.run.xml`                       | **Renamed** — see rule below |
| `node_modules/fa-mcp-sdk/cli-template/gitignore`                  | `.gitignore`                                | source has no leading dot |
| `node_modules/fa-mcp-sdk/cli-template/FA-MCP-SDK-DOC/`            | `FA-MCP-SDK-DOC/`                           | auto-updated by `update-doc.js` |

#### Rule: package.json — ADD ONLY new dependencies, do NOT touch anything else

The project's `package.json` has evolved since generation (project-specific name, version, scripts, dependencies the team has added). When the SDK's template `package.json` changes:

1. Diff `node_modules/fa-mcp-sdk/cli-template/package.json` (TO) against the same file at the FROM version.
2. Identify ONLY dependencies/devDependencies that were **added** (not changed versions of existing ones, not removed).
3. The generated guide must instruct the user: "Add these NEW entries to your `package.json` `dependencies`/`devDependencies` sections. Do NOT touch any other field — name, version, scripts, existing deps stay as they are."
4. If a dep was **removed** from the template, mention it as informational only — do not instruct deletion from the project (it may still be in use).
5. Do NOT suggest overwriting `scripts`, `engines`, `type`, or any other field.

Provide a copy-pasteable JSON snippet with only the new keys:
```json
{
  "dependencies": {
    "<new-dep>": "<version>"
  }
}
```

#### Rule: `r/` → `.run/` with filename transformation

The project has no `r/` directory — it was renamed to `.run/` at project generation, and each `<name>.xml` inside was 
renamed to `<name>.run.xml`. When the SDK template ships new or changed files in `cli-template/r/`:

- Source: `node_modules/fa-mcp-sdk/cli-template/r/<name>.xml`
- Destination: `.run/<name>.run.xml`
- Action for NEW files: copy `<name>.xml` → `.run/<name>.run.xml`
- Action for CHANGED files: copy with the same rename, overwriting the existing `.run.xml` file (warn the user to back up any customizations)
- Action for REMOVED files: informational only — do not delete the project's `.run/<name>.run.xml` automatically

The generated guide must show the exact source → destination mapping for each changed file, with the filename transformation applied.

#### Rule: `.claude/skills/<skill>/SKILL.md`

This is a Claude Code skill that the project owns a copy of. If the SDK ships an updated version, instruct the user to 
overwrite their local copy from `node_modules/fa-mcp-sdk/cli-template/.claude/skills/<skill>/SKILL.md` — unless they've 
customized it locally, in which case manual merge.

For any other changed template file, the generated guide must include:
- The exact source path under `node_modules/fa-mcp-sdk/cli-template/...`
- The exact destination path in the project
- Whether to **overwrite** or **merge carefully** (because the project may have local customizations)

### 4.4 Analyze changes in scripts

The CLI copies scripts from `node_modules/fa-mcp-sdk/scripts/` (NOT from `cli-template/scripts/`) into the project's 
`scripts/` directory, and then removes `copy-static.js` and `publish.sh` (SDK-internal, not needed in downstream projects).

- Canonical source: `node_modules/fa-mcp-sdk/scripts/<name>.js`
- Project destination: `scripts/<name>.js`
- Exclude from upgrade suggestions: `copy-static.js`, `publish.sh` (SDK-only)

The generated guide must specify the exact source path under `node_modules/fa-mcp-sdk/scripts/...` for any script the 
user should copy into their project's `scripts/` directory, and skip the excluded SDK-only scripts.

### 4.5 Analyze changes in core library exports

Read `node_modules/fa-mcp-sdk/dist/core/index.js` (or `.d.ts`) to identify:
- New exports that may be useful
- Removed/renamed exports that may break existing code
- Changed type signatures

### 4.6 Check project code for breaking changes

Scan the project's `src/` directory for:
- Imports from `fa-mcp-sdk` that reference removed/renamed exports
- Usage of deprecated APIs
- Config keys that have been renamed or restructured

## Step 5: Generate Migration Guide

Write ALL headings, descriptions, and prose in the detected language (default: English).
Technical content (file paths, YAML keys, code blocks, shell commands) is always in English.

Create a file `upgrade-guide-<old>-to-<new>.md` in the project root with the following structure:

```markdown
# FA-MCP-SDK Migration Guide: v<old> -> v<new>

Generated: <timestamp>

## Summary

<Brief overview of what changed and the scope of required updates>

## Breaking Changes

<List any breaking changes that MUST be addressed. For each:>
- What changed
- What code/config is affected
- Exact fix with code snippets

## Config Changes

### New Configuration Keys

<For each new key, provide:>
- Key path (e.g., `webServer.adminAuth.type`)
- Default value
- Description
- Whether it needs to be added to the project's config

### Changed Defaults

<Keys where default values changed>

### Removed Keys

<Keys that were removed>

### Recommended config/default.yaml additions

    ```yaml
    # Add these sections to your config/default.yaml:
    <actual YAML snippets to add>
    ```

### Recommended config/custom-environment-variables.yaml additions

    ```yaml
    # Add these mappings:
    <actual YAML snippets>
    ```

## Template File Changes

> **Source of truth**: all updated template files live under `node_modules/fa-mcp-sdk/cli-template/` (after `yarn add fa-mcp-sdk@<TO>`). Copy from there into the project.

### package.json

> **Only ADD new dependencies. Do NOT touch anything else** (name, version, scripts, existing deps — all stay untouched). Source: `node_modules/fa-mcp-sdk/cli-template/package.json`.

<List only dependencies/devDependencies that were newly added in the SDK template. Provide a copy-pasteable JSON snippet 
with only the new keys. Mention removed deps as informational only — do not instruct deletion.>

### `.run/` (from `cli-template/r/`)

<For each changed `cli-template/r/<name>.xml`, show the mapping:>
- Source: `node_modules/fa-mcp-sdk/cli-template/r/<name>.xml`
- Destination: `.run/<name>.run.xml` (note the rename)
- Action: copy + rename (overwrite, warn about local customizations)

### Claude Code Skills (`.claude/skills/`)

<For each updated skill, e.g. `upgrade-guide`:>
- Source: `node_modules/fa-mcp-sdk/cli-template/.claude/skills/<skill-name>/SKILL.md`
- Destination: `.claude/skills/<skill-name>/SKILL.md`
- Action: overwrite (unless locally customized — then manual merge)

### Other Template Files

<For each: source path under `node_modules/fa-mcp-sdk/cli-template/...`, destination, overwrite or merge.>

## New Features

<New SDK features that the project can now use>

## New/Updated Scripts

<Scripts that should be copied or updated>

## Code Changes Required

<Specific code changes needed in the project's src/ files, with before/after examples>

## Recommended Actions

<Ordered checklist of actions to complete the upgrade>

1. [ ] ...
2. [ ] ...
```

## Step 6: Assess Impact on the Project

After generating the guide, scan the current project's source code (`src/`, `config/`, `tests/`) to evaluate how the 
changes specifically affect THIS project. Add a section to the guide:

```markdown
## Impact Assessment for This Project

### Affected Files

<List of project files that need modification, with specific changes>

### Risk Level

<Low / Medium / High — based on the number and nature of breaking changes>

### Estimated Effort

<Brief assessment of the work required>
```

## Step 7: Present Results

1. Display a summary of the key findings to the user.
2. Tell the user the full guide has been saved to `upgrade-guide-<old>-to-<new>.md`.
3. Ask if they want you to apply any of the recommended changes automatically.

## Important Rules

- ALWAYS read the actual files to compare — do not guess or assume what changed.
- When comparing YAML configs, preserve comments and structure.
- Do not modify project files other than `package.json` (via yarn add) and `FA-MCP-SDK-DOC/` (via update-doc.js) unless the user explicitly asks.
- The migration guide must contain ACTIONABLE instructions with exact code/config snippets — not vague recommendations.
- If GitHub API is unavailable or rate-limited, fall back to comparing files directly from `node_modules/fa-mcp-sdk/` against project files.
- Write the guide in the language detected from the user's arguments (default: **English**). Translate all headings, prose, and descriptions. Keep file paths, YAML keys, code blocks, and shell commands in English.
