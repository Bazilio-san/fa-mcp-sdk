# Task Plan Rules

Read before creating, modifying, or executing a plan. Before modifying model instructions, also read
[AGENTS-PROMPT-RULES.md](/AGENTS-PROMPT-RULES.md).

## Location

Keep active plans in `_prompts/_progress`, completed plans in `_prompts/done`, deferred plans in `_prompts/_shelf`,
and future plans in `_prompts/_future`. Prefix filenames with the creation time, `YYYY-MM-DD--HH-MM--`.
Move a plan to `done` only after completing every item, preserving its filename.

## Contents

Immediately after the title, add `## Overview`: an explanation understandable to a nonspecialist, without paths,
function names, fields, parameters, or unexplained abbreviations. Use the subsections needed: "Problem", "Current
State", "Solution", and "Expected Outcome". Follow this with `## Instructions for the Agent (LLM)` containing standing
execution instructions.

Divide the work into stages with `- [ ]` checklists. Each item must describe a verifiable result and allow safe
repetition. Begin each stage with an independent way to check its completion. Make documentation updates the final
stage. End with `## Execution Notes` containing dated entries. Include verified paths, entry points, initial values,
decisions, requirements, commands, and acceptance criteria. The plan must be sufficient without conversation history
and after a session interruption. Separate facts from requirements; describe the solution instead of referring to
"the approach discussed earlier".

## Execution

Immediately after completing each item, mark it `- [x]` in the plan. Record open questions, decisions, and check
results in the notes. Do not create Git commits without an explicit user instruction. When using a separate worktree
with permission to commit, save changes and the plan before each rebase onto the current main branch. Do not touch
other people's changes. Integrate branches according to
[AGENTS-GIT-WORKTREE-RULES.md](/AGENTS-GIT-WORKTREE-RULES.md).

After each item, display a 64-character bar: the rounded proportion of `█` characters equals the proportion of
completed items; use `░` for the remainder. Show an integer percentage beside it and completed/total counts on the
next line. Put both lines in a whitespace-preserving block. During long-running work, repeat at least every
20 minutes. Include these instructions in every new plan. Checklist marks are the sole source of progress figures.

In the library, update the relevant documents and `cli-template/FA-MCP-SDK-DOC/`; in a generated project, update its
documentation.
