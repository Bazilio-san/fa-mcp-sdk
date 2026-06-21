---
name: edit-claude-files
description: "Protocol for creating, editing OR deleting any file under .claude/ (SKILL.md, scripts, hooks, agents, settings.json, etc.). Use it BEFORE any such change — direct Write/Edit is denied by settings.json and direct shell ops (rm/mv/cp/redirect) on .claude are blocked by the harness, so every change MUST go through the scripts/fcp.js channel."
allowed-tools: Read, Write, Edit, MultiEdit, Bash(node scripts/fcp.js *), Bash(rm:*)
---

# Editing files in `.claude/`

**Scope — read carefully.** This applies to **every file under `.claude/`** and to **every kind of change**:
creating, editing, **deleting**, renaming, moving. It covers `SKILL.md`, scripts in
`.claude/skills/<skill>/scripts/`, hooks in `.claude/hooks/`, agents in `.claude/agents/`, supporting reference
files, `settings.json` — anything inside the tree.

**Never attempt a direct change, not even once.** Two layers block direct access on purpose:

- `settings.json` denies the `Write` and `Edit` tools on `.claude/**`.
- The harness blocks direct shell modification of `.claude/` — `rm`, `mv`, `cp`, `>`/`>>` redirection, `sed -i`,
  and the like. (Reading is always fine.)

So do NOT reach for `Write`/`Edit`/`rm` on a `.claude/` path and fall back when it fails — that wastes a denied
call. Go straight to the `fcp.js` channel below, which runs as `node` (an allowlisted command) and is the ONLY
sanctioned way in, for writes AND deletes.

## Protocol

**Create or overwrite a file.** Write the new content to a temp file OUTSIDE `.claude/`, then save it in (note the
argument order: destination first, source temp second):

```bash
# (optional) start from the current content by copying it OUT to a temp you can edit:
node scripts/fcp.js tmp-edit.md .claude/skills/<skill-name>/SKILL.md
# edit tmp-edit.md with Edit/Write (it is outside .claude), then save it back IN:
node scripts/fcp.js .claude/skills/<skill-name>/SKILL.md tmp-edit.md
rm tmp-edit.md
```

For a brand-new file, just write the temp file and `fcp.js` it in — parent directories are created automatically:

```bash
node scripts/fcp.js .claude/skills/<skill-name>/scripts/new-script.js tmp-new-script.js
rm tmp-new-script.js
```

**Delete a file or directory** under `.claude/` — use the delete mode, never `rm` directly:

```bash
node scripts/fcp.js --rm .claude/skills/<skill-name>/scripts/old-script.js
node scripts/fcp.js --rm .claude/skills/<skill-name>            # a whole directory, removed recursively
```

The temp files live OUTSIDE `.claude/`, so they are edited and `rm`-ed normally.

CRITICAL: Never use `Edit`/`Write`/`rm`/`mv`/`cp` directly on a path inside `.claude/`. All create, edit and delete
operations go through `node scripts/fcp.js` — every file, every time.
