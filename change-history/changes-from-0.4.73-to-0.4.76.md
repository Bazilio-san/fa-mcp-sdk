# Changes: 0.4.73 → 0.4.76

- **From commit:** `b59ff46` (v0.4.73)
- **To commit:** `2406106` (v0.4.76)
- **Generated:** 2026-05-10
- **Commits in range:** 11

## Summary

Tooling migration from ESLint to Oxlint + Oxfmt across the SDK. Two new authoring skills
shipped to MCP projects (`mcp-app-create`, `mcp-app-add-to-server`). The Agent Tester guide
gained a Windows-specific UTF-8 workaround for `curl`. Most `src/core/**` files received an
oxfmt formatting pass (no behavioral or public-API changes).

## Changed Files

**MCP-synced docs** (propagate via `update-sdk.js`):

- [M] `FA-MCP-SDK-DOC/08-agent-tester-and-headless-api.md` — adds Windows UTF-8 curl note

**MCP-synced .claude** (propagate via `update-sdk.js`, except pinned folders):

- [M] `.claude/agents/javascript-pro.md`
- [D] `.claude/hooks/eslint-fix.cjs` — replaced by Oxlint/Oxfmt workflow
- [A] `.claude/skills/mcp-app-add-to-server/SKILL.md` — new authoring skill
- [A] `.claude/skills/mcp-app-create/SKILL.md` — new authoring skill
- [M] `.claude/skills/upgrade-guide/SKILL.md`

**Core (SDK library, consumed via `fa-mcp-sdk` import)** — formatting-only pass:

- ~70 files under `src/core/**` reformatted by `oxfmt` (multi-line `export` statements
  collapsed to single lines, indentation/spacing normalized). Net +1130/−1158 lines, no API
  surface changes — the public exports in `src/core/index.ts` are identical.

## ⚠️ Breaking Changes

- **`.claude/hooks/eslint-fix.cjs` was deleted from the synced template.** If your MCP's
  `.claude/settings.json` references this hook, the reference will dangle after running
  `update-sdk.js`. Action required in your MCP: open `.claude/settings.json`, remove the
  `eslint-fix.cjs` hook entry, and (optionally) wire up an Oxlint/Oxfmt-based replacement
  if you want equivalent on-edit linting.

## 🔧 Configuration Changes

None — no `config/` files changed in this range.

## Commits

- `6739dba` 0.4.74
- `1d106df` Document Windows-specific UTF-8 encoding workaround for `curl` in Agent Tester guide.
- `01aa4da` Skills `mcp-app-create` and `mcp-app-add-to-server`
- `a2ef2a8` DOC about `mcp-app-create` and `mcp-app-add-to-server` skills
- `1003979` Add domain-specific examples to `mcp-app-create` and `mcp-app-add-to-server` documentation.
- `e264358` 0.4.76
- `198f92e` chore: install oxfmt + oxlint, add .oxlintrc.json + .oxfmtrc.json (root + cli-template)
- `cdb3163` chore: switch Claude hook from eslint-fix to oxlint-oxfmt-fix
- `afa6c3d` docs: switch ESLint references to Oxlint/Oxfmt across CLAUDE.md, README.md, skills
- `f2d2b95` chore: apply oxfmt formatting
- `2406106` chore: remove oxlint-oxfmt-fix hooks and update settings to reference new script path
