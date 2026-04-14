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

**Two arguments** — explicit FROM and TO:
- `/upgrade-guide 0.4.30 0.4.37` — from version 0.4.30 to 0.4.37
- `/upgrade-guide abc1234 def5678` — from commit to commit

**One argument** — FROM is the current installed version, TO is the argument:
- `/upgrade-guide 0.5.0` — upgrade from current to 0.5.0
- `/upgrade-guide abc1234` — upgrade from current to that commit

**No arguments** — FROM is the current installed version, TO is the latest published version.

## Step 1: Determine Versions

1. Read the current project's `package.json` and extract the installed `fa-mcp-sdk` version — this is the **default FROM**.
2. Run `yarn info fa-mcp-sdk version` (or `npm view fa-mcp-sdk version`) to get the latest published version — this is the **default TO**.
3. Apply argument parsing rules above to determine the actual FROM and TO.
4. If FROM equals TO — inform the user and stop.

Display to the user:
```
From: X.Y.Z (or commit hash)
To:   A.B.C (or commit hash)
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

These directories in the SDK template may have changed:

- `node_modules/fa-mcp-sdk/cli-template/` — the project template

Compare template files with their project counterparts. Key files to check:

- `package.json` — new scripts, dependency changes
- `tsconfig.json` — compiler option changes
- `eslint.config.js` — linting rule changes
- `CLAUDE.md` — project instructions updates
- `deploy/` — deployment configuration changes
- `jest.config.js` — test configuration changes
- `.claude/skills/` — new or updated skills

### 4.4 Analyze changes in scripts

Check `node_modules/fa-mcp-sdk/scripts/` for new or modified scripts that may need to be copied or adapted in the project.

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

### package.json

<New scripts, changed dependencies, etc.>

### Other Template Files

<Changes in tsconfig.json, eslint.config.js, deploy/, etc.>

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

After generating the guide, scan the current project's source code (`src/`, `config/`, `tests/`) to evaluate how the changes specifically affect THIS project. Add a section to the guide:

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
