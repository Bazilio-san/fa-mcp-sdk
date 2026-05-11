# scripts/publish.js

Cross-platform publish script. Bumps the patch version, commits the changes,
pushes to `master`, and runs `npm publish`.

## Usage

```bash
node scripts/publish.js              # default: bump + commit tracked changes + push + publish
node scripts/publish.js --no-bump    # publish current version as-is, no bump
node scripts/publish.js --add-all    # also include untracked files in the commit
node scripts/publish.js --no-bump --add-all   # combine
node scripts/publish.js --help
```

## Flags

| Flag             | Short | Effect                                                                                 |
|------------------|-------|----------------------------------------------------------------------------------------|
| `--no-bump`      | `-n`  | Skip patch version bump. Publish the current `package.json` version as-is.             |
| `--add-all`      | `-a`  | Stage untracked files too (`git add --all`). Default stages only tracked changes.      |
| `--help`         | `-h`  | Show usage and exit.                                                                   |

## Workflow

1. **Branch check** — must be on `master`. Otherwise prints a warning and exits.
2. **Build** — runs `npm run cb` (clean + build). Aborts on failure.
3. **Version bump** (skipped with `--no-bump`):
   - Reads current version from `package.json`.
   - Increments patch: `0.4.79` → `0.4.80`.
   - Writes new version into `package.json` (replaces first occurrence only).
   - Updates the `fa-mcp-sdk` dependency line in `cli-template/package.json` to `"^<new-version>"`.
4. **Stage changes**:
   - Default: `git add -u` — stages modifications and deletions to **tracked** files only.
   - With `--add-all`: `git add --all` — also stages untracked files.
5. **Commit + push** — if anything is staged, commits with the version string as the message
   (`--no-verify`, bypasses hooks) and pushes to `origin master`. If the index is empty, both steps are skipped.
6. **Publish** — runs `npm publish`.
7. **Pause** — waits for Enter before exiting (matches the original bash behavior for interactive runs).

## What gets committed (default mode)

| File state                                         | Committed by default? | With `--add-all`? |
|----------------------------------------------------|-----------------------|-------------------|
| Bumped `package.json` (tracked + modified)         | ✅ Yes                | ✅ Yes            |
| Bumped `cli-template/package.json`                 | ✅ Yes                | ✅ Yes            |
| Other tracked files you modified (no `git add`)    | ✅ Yes                | ✅ Yes            |
| Tracked files you deleted (no `git add`)           | ✅ Yes                | ✅ Yes            |
| Untracked files (new files, not in git)            | ❌ No                 | ✅ Yes            |
| Files you already `git add`-ed manually            | ✅ Yes                | ✅ Yes            |

Rationale: `git add -u` mirrors `git commit -a` semantics — pick up edits to tracked files but never silently include
brand-new files. Use `--add-all` when you explicitly want untracked files in the release commit.

## Edge cases

- **Wrong branch** — script exits without making any changes. No bump, no publish.
- **Build fails** — script aborts before version bump and before any git operations.
- **Nothing staged** (e.g., `--no-bump` and clean working tree) — `git commit`/`push` are skipped,
  but `npm publish` still runs. Useful for re-publishing a version that was rolled back on the registry.
- **Pre-existing manual `git add`** — those files are also committed; the script does not reset the index.
- **Re-running after a failed publish** — use `--no-bump` to avoid double-incrementing the version.

## Errors and pause behavior

On any failure (build, git, etc.) the script:
1. Prints a red error line.
2. Waits for Enter (so you can read the output when run via double-click in IDE/Explorer).
3. Exits with code `0` (matches the original bash; keeps the terminal window open in interactive shells).
