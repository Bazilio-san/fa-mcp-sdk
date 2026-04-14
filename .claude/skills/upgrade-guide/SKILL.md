---
name: upgrade-guide
description: "Generate an upgrade guide for projects built on fa-mcp-sdk. Use when user asks to create/prepare/generate an upgrade instruction/guide, mentions 'инструкция по обновлению', 'upgrade guide', 'migration guide', or wants to see what changed between fa-mcp-sdk versions."
disable-model-invocation: true
argument-hint: "[from-version-or-commit] [to-version-or-commit] [language hint]"
allowed-tools: Bash(git *) Read Write Glob Grep
---

# FA-MCP-SDK Upgrade Guide Generator

Generate an MD file with a step-by-step upgrade guide for projects built on fa-mcp-sdk.

## Argument Parsing

Parse `$ARGUMENTS` to extract version/commit references and an optional language hint:

### Language detection

Look for a natural-language phrase anywhere in the arguments that indicates the desired output language. Examples:
- "на русском", "по-русски", "in Russian", "ru" → Russian
- "in English", "en" → English
- Any similar phrase or ISO 639-1 code

Remove the language hint from the arguments before parsing version/commit refs.

**Default: English** if no language hint is found.

The detected language determines ALL human-readable text in the generated guide (headings, descriptions, recommendations). 
Technical content (file paths, YAML keys, code snippets, commands) stays as-is regardless of language.

### Version/commit references

After stripping the language hint, the remaining arguments are version/commit references:

**Two arguments** — range between two points:
- `1.0.0 1.1.0` or `v0.4.30 v0.4.37` — version tags
- `abc1234 def5678` — commit hashes
- `0.4.30` and `v0.4.30` are equivalent — normalize by stripping the `v` prefix when looking up git tags

**One argument** — from that point to current HEAD:
- `1.0.0` or `v0.4.30` — version tag to HEAD
- `abc1234def...` — commit hash to HEAD

**No arguments** — ask the user for at least a starting version or commit.

### Resolving References

- If the argument looks like a semver (e.g., `0.4.30`, `1.0.0`), try to find a git tag. Check both `v<version>` and `<version>` tag formats. If no tag found, search in `git log --oneline --all` for a commit message containing the version string (e.g., the version bump commit).
- If the argument looks like a commit hash (7+ hex chars), use it directly.
- The TO reference defaults to HEAD if not specified.

## Step-by-step Workflow

### Step 1: Determine the diff range

Resolve FROM and TO references as described above. Verify both references exist:

```bash
git rev-parse --verify <FROM_REF>
git rev-parse --verify <TO_REF>
```

If either fails, report the error and stop.

Get the short hashes and any associated version info for display:
```bash
git log --oneline -1 <FROM_REF>
git log --oneline -1 <TO_REF>
```

### Step 2: Get the list of changed files

```bash
git diff --name-only <FROM_REF> <TO_REF>
```

### Step 3: Analyze changes in key areas

Focus on these directories/files that directly affect downstream projects:

#### 3a. Config files (`config/`)

These files are critical — downstream projects have their own copies that must stay in sync:
- `config/default.yaml` — main defaults
- `config/local.yaml` — local overrides
- `config/_local.yaml` — private local config template
- `config/custom-environment-variables.yaml` — env var mappings

For each changed config file, run:
```bash
git diff <FROM_REF> <TO_REF> -- config/<filename>
```

Analyze the diff and describe:
- New configuration keys added (with their default values)
- Removed configuration keys
- Changed default values
- New environment variable mappings

#### 3b. CLI template files (`cli-template/`)

These files are copied into new projects. Changes here mean existing projects may need updates:
```bash
git diff --name-only <FROM_REF> <TO_REF> -- cli-template/
```

For each changed file, get the diff and describe what changed and why the project might need updating.

#### 3c. Scripts (`scripts/`)

```bash
git diff --name-only <FROM_REF> <TO_REF> -- scripts/
```

For each changed script, describe what changed and whether downstream projects need to copy/update the script.

#### 3d. Core library changes (`src/core/`)

```bash
git diff --name-only <FROM_REF> <TO_REF> -- src/core/
```

Summarize significant API changes, new exports, removed exports, changed signatures. Check `src/core/index.ts` for export changes.

#### 3e. Package dependencies

```bash
git diff <FROM_REF> <TO_REF> -- package.json
```

Note any added, removed, or updated dependencies that downstream projects should be aware of.

### Step 4: Review commit messages

```bash
git log --oneline <FROM_REF>..<TO_REF>
```

Use commit messages to understand the purpose of changes and provide context in the guide.

### Step 5: Generate the upgrade guide MD file

Create a file named `UPGRADE-<FROM>-to-<TO>.md` in the project root, where FROM and TO are version numbers or short commit hashes.

Write ALL headings, descriptions, and prose in the detected language (default: English).
Technical content (file paths, YAML keys, code blocks, shell commands) is always in English.

Below is the structural template. The heading texts shown here are in English — translate them to the target language as needed:

```markdown
# fa-mcp-sdk Upgrade Guide

**From:** <FROM version/commit> (<date>)
**To:** <TO version/commit> (<date>)
**Guide generated:** <today>

## Summary of Changes

<Brief summary of what changed and why, based on commit messages>

## Upgrade Steps

### 1. Update the fa-mcp-sdk package

    ```bash
    yarn add fa-mcp-sdk
    ```
(or `npm install fa-mcp-sdk`)

### 2. Update documentation

    ```bash
    node ./scripts/update-doc.js
    ```

### 3. Configuration Changes

<For each changed config file, provide specific instructions>

#### config/default.yaml
<What keys were added/removed/changed, with exact values to add>

#### config/custom-environment-variables.yaml
<New env var mappings to add>

... (other config files as needed)

### 4. Template File Changes (cli-template/)

<For each changed template file>

#### <filename>
<What changed, what to do in your project>

### 5. Script Changes (scripts/)

<For each changed script>

#### <script-name>
<What changed, action required>

### 6. Library API Changes (src/core/)

<Significant API changes that may affect project code>

### 7. Dependency Changes

<New/updated/removed dependencies>

## Recommendations

<Specific recommendations for adapting the project, based on the nature of changes>

## Full List of Changed Files

<Full list of changed files for reference>
```

### Step 6: Present the result

After creating the file:
1. Show the filename and its location
2. Show a brief summary of the most important changes
3. Note any changes that require manual attention or decision-making

## Important Rules

- Write the guide in the language detected from the user's arguments (default: **English**). Translate all headings, prose, and descriptions. Keep file paths, YAML keys, code blocks, and shell commands in English.
- Be **specific**: include exact config key names, exact file paths, exact values to change.
- For config changes, show the actual YAML snippets to add/modify, not just descriptions.
- If a config section was restructured, show both the old and new structure.
- For file changes in `cli-template/`, note whether the file should be **copied as-is** or **merged carefully** (because the downstream project may have customizations).
- Do NOT include changes to files that are internal to the SDK and don't affect downstream projects (e.g., `src/core/` internal refactoring that doesn't change the public API).
- If there are breaking changes, highlight them prominently with a ⚠️ marker.
- If no changes were found in a section, omit that section from the guide.
- The guide should be actionable — a developer should be able to follow it step by step without needing to look at the git diffs themselves.
