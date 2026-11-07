---
name: edit-claude-files
description: >-
  Protocol for creating, editing or deleting any file under .claude/ through the required scripts/fcp.js atomic
  channel. Use it before changing settings, hooks, links or other files in that tree.
allowed-tools: Read, Write, Edit, MultiEdit, Bash(node scripts/fcp.js *), Bash(rm:*)
---

# Editing files in `.claude/`

Skills are stored in `.agents/skills/`; edit their canonical paths normally. `.claude/skills` is a generated
link to that directory. The protocol below still applies to changes made through `.claude/`, including settings,
hooks and the link itself. Link maintenance uses `scripts/fcp.js --move <destination> <source>` and
`scripts/fcp.js --link <link> <directory>`; neither command overwrites an existing destination.

**Scope of this rule — read carefully.** It applies to **every file under `.claude/`** — not only `SKILL.md`. 
This includes scripts in `.claude/skills/<skill>/scripts/`, hooks in `.claude/hooks/`, supporting reference files, 
`settings.json`, and anything else inside the directory. Claude Code watches the whole tree and reloads on change; 
direct writes risk partial reads and inconsistent state during multi-edit sessions.

The project requires the temporary-copy protocol below independently of the active `settings.json` permissions.
Do not attempt a direct edit even when the current permission rules would allow it.

**Protocol — every file, every time:**

1. **Copy** the target file to a temp location outside `.claude/` (works for any file type: md, js,
   json, cjs, …):
   ```bash
   node scripts/fcp.js tmp-edit.md .claude/skills/<skill-name>/SKILL.md
   node scripts/fcp.js tmp-helper.js .claude/skills/<skill-name>/scripts/helper.js
   ```
2. **Edit** the temp file — make ALL changes there (multiple Edit calls are fine).
3. **Save** atomically via the helper script (same command, reversed argument order):
   ```bash
   node scripts/fcp.js .claude/skills/<skill-name>/SKILL.md tmp-edit.md
   node scripts/fcp.js .claude/skills/<skill-name>/scripts/helper.js tmp-helper.js
   ```
4. **Remove** the temp file:
   ```bash
   rm tmp-edit.md
   ```

**Creating a new file in `.claude/`** — same protocol, just start from an empty temp file:

```bash
# Write the new file somewhere OUTSIDE .claude/, then fcp.js it in:
node scripts/fcp.js .claude/skills/<skill-name>/scripts/new-script.js tmp-new-script.js
rm tmp-new-script.js
```

CRITICAL: Never use `Edit` or `Write` directly on files inside `.claude/` — always go through the
temp-copy workflow above. This covers SKILL.md, scripts, hooks, agents, settings — everything.
