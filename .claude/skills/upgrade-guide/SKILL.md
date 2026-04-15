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
- `config/_local.yaml` — local config template (the CLI scaffolder copies this to the project's `config/_local.yaml` and also derives `config/local.yaml` from it with template parameter substitutions)
- `config/local.yaml` — SDK's own local overrides (not shipped to projects; used as reference)
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

**Correlate changes across config files.** When `config/default.yaml` has changes (new keys, restructured sections, changed defaults), you MUST also check `config/_local.yaml` for analogous changes. The `_local.yaml` file mirrors the structure of `default.yaml` but contains local-override values — if a section was added or restructured in `default.yaml`, the same section likely needs updating in `_local.yaml`.

Run both diffs together when `default.yaml` changed:
```bash
git diff <FROM_REF> <TO_REF> -- config/default.yaml
git diff <FROM_REF> <TO_REF> -- config/_local.yaml
```

If `default.yaml` changed but `_local.yaml` did NOT, explicitly note this in the guide: the downstream project's `config/_local.yaml` may still need manual updates to stay consistent with the new `default.yaml` structure.

**Config file mapping (source of truth → project destination):**

| SDK source (in `config/`)            | Project destination             | Action |
|--------------------------------------|---------------------------------|--------|
| `config/default.yaml`                | `config/default.yaml`           | Add new keys; do NOT remove existing keys the project may have customized |
| `config/_local.yaml`                 | `config/_local.yaml`            | Update to match SDK — this is the template users derive their `local.yaml` from |
| `config/_local.yaml` (via CLI)       | `config/local.yaml`             | Derived by CLI from `_local.yaml` with `{{param}}` substitutions — check for needed adjustments |
| `config/custom-environment-variables.yaml` | `config/custom-environment-variables.yaml` | Add new env var mappings |
| `config/local.yaml` (SDK's own)      | *(not shipped — reference only)* | Use as reference for what the SDK itself overrides locally |

#### 3b. CLI template files (`cli-template/`)

These files are copied into new projects by the CLI (`bin/fa-mcp.js`). Changes here mean existing downstream projects may need updates. Use:
```bash
git diff --name-only <FROM_REF> <TO_REF> -- cli-template/
```

When describing required actions in the generated guide, instruct downstream projects to take the new file from `node_modules/fa-mcp-sdk/cli-template/...` (after `yarn add fa-mcp-sdk@<TO>`). The CLI applies transformations at project generation time — the generated guide must respect the same mapping so upgrades match what a fresh `fa-mcp` scaffold would produce.

Mapping of template source → project destination (replicate in the generated guide):

| Template (source of truth)                                        | Project (destination)                       | Action |
|-------------------------------------------------------------------|---------------------------------------------|--------|
| `node_modules/fa-mcp-sdk/cli-template/package.json`               | `package.json`                              | **ADD new deps only** (see rule below) |
| `node_modules/fa-mcp-sdk/cli-template/tsconfig.json`              | `tsconfig.json`                             | overwrite (unless customized) |
| `node_modules/fa-mcp-sdk/cli-template/eslint.config.js`           | `eslint.config.js`                          | overwrite (unless customized) |
| `node_modules/fa-mcp-sdk/cli-template/CLAUDE.md`                  | `CLAUDE.md`                                 | merge — project may add custom sections |
| `node_modules/fa-mcp-sdk/cli-template/jest.config.js`             | `jest.config.js`                            | overwrite (unless customized) |
| `node_modules/fa-mcp-sdk/cli-template/deploy/`                    | `deploy/`                                   | merge per file |
| `node_modules/fa-mcp-sdk/cli-template/.claude/skills/<skill>/`    | `.claude/skills/<skill>/`                   | overwrite unless locally customized |
| `node_modules/fa-mcp-sdk/cli-template/r/<name>.xml`               | `.run/<name>.run.xml`                       | **Renamed** (see rule below) |
| `node_modules/fa-mcp-sdk/cli-template/gitignore`                  | `.gitignore`                                | source has no leading dot |
| `node_modules/fa-mcp-sdk/cli-template/FA-MCP-SDK-DOC/`            | `FA-MCP-SDK-DOC/`                           | auto-updated by `scripts/update-doc.js` |

**Rule: `package.json` — ADD ONLY new dependencies, do NOT touch anything else.**
Diff the template `package.json` between FROM and TO. In the generated guide, list ONLY dependencies/devDependencies that were **added** (not changed versions of existing ones, not removed). Instruct the user: "Add these NEW entries to your `package.json` — do NOT touch `name`, `version`, `scripts`, `engines`, or any existing deps." Mention removed deps as informational only — do not instruct deletion (they may still be in use in the project). Do NOT suggest overwriting scripts or any non-dependency fields. Provide a copy-pasteable JSON snippet with only the new keys.

**Rule: `r/` → `.run/` with filename transformation.**
The downstream project has no `r/` directory — at project generation the CLI renamed `cli-template/r/` to `.run/`, and each `<name>.xml` inside was renamed to `<name>.run.xml`. For each changed file in `cli-template/r/`, the generated guide must show:
- Source: `node_modules/fa-mcp-sdk/cli-template/r/<name>.xml`
- Destination: `.run/<name>.run.xml`
- NEW file → copy + rename; CHANGED file → overwrite with rename (warn about local customizations); REMOVED file → informational only (do not delete automatically).

**Rule: `.claude/skills/<skill>/SKILL.md`.**
These are Claude Code skills the project owns a copy of. If the SDK ships an updated version, instruct overwrite from `node_modules/fa-mcp-sdk/cli-template/.claude/skills/<skill>/SKILL.md` — unless locally customized, then manual merge.

#### 3c. Scripts (`scripts/`)

The CLI copies scripts from the SDK's **`scripts/`** directory (NOT from `cli-template/scripts/`) into the downstream project's `scripts/`, and removes `copy-static.js` and `publish.sh` (SDK-internal).

```bash
git diff --name-only <FROM_REF> <TO_REF> -- scripts/
```

In the generated guide:
- Canonical source: `node_modules/fa-mcp-sdk/scripts/<name>.js`
- Project destination: `scripts/<name>.js`
- Exclude from upgrade suggestions: `copy-static.js`, `publish.sh` (SDK-only, not shipped to downstream projects)

For each changed script, describe what changed and whether downstream projects need to copy/update it, using the `node_modules/fa-mcp-sdk/scripts/...` path as the source.

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

#### config/_local.yaml
<If `default.yaml` changed, check whether `_local.yaml` also changed in the same diff range. If it did: describe what changed. If it did NOT but the `default.yaml` changes affect keys that also exist in `_local.yaml` (because `_local.yaml` overrides those keys), explicitly warn that the project's `config/_local.yaml` may need manual updates to stay consistent with the new `default.yaml` structure.>

#### config/local.yaml (project-local overrides)
<Check whether the downstream project's `config/local.yaml` might override keys that changed in `default.yaml` or `_local.yaml`. If `local.yaml` in the project contains overrides for sections that were added/restructured, instruct the user to verify and update those overrides. This is especially important when: a new required key is added to `default.yaml` that the project's `local.yaml` doesn't override (user just needs to know it exists); a key's meaning or structure changed and `local.yaml` has a stale override; `local.yaml` was derived from the old `_local.yaml` and needs re-derivation from the updated template.>

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
- **Correlate config file changes**: when `config/default.yaml` changes, ALWAYS also check `config/_local.yaml` in the same diff range. Report whether `_local.yaml` has analogous changes or needs manual updates. Also advise checking the downstream project's `config/local.yaml` for stale overrides that may conflict with the new defaults.
- **Do not forget `config/local.yaml` in the project**: the downstream project's `config/local.yaml` overrides `config/default.yaml`. When new keys are added or sections restructured in `default.yaml`, explicitly instruct the user to verify that their `config/local.yaml` doesn't have stale overrides that conflict with the new structure, and to add any new keys there too if they want non-default values.
- If a config section was restructured, show both the old and new structure.
- For file changes in `cli-template/`, note whether the file should be **copied as-is** or **merged carefully** (because the downstream project may have customizations).
- Do NOT include changes to files that are internal to the SDK and don't affect downstream projects (e.g., `src/core/` internal refactoring that doesn't change the public API).
- If there are breaking changes, highlight them prominently with a ⚠️ marker.
- If no changes were found in a section, omit that section from the guide.
- The guide should be actionable — a developer should be able to follow it step by step without needing to look at the git diffs themselves.
