# Git Worktree Rules

Read before working in separate worktrees, the shared directory, or integrating branches. Determine the main branch
from the repository settings; do not assume its name. Check `git status` before making changes.

## Integration

Use `git rebase` and `git merge --ff-only`; do not create merge commits. Resolve conflicts according to the intended
behavior while preserving the contracts of the library and generated projects. If the main branch advances, rebase
again and repeat the affected checks. Do not restore deleted code by mechanically choosing one side of a conflict.

## Collaboration

Do not overwrite other people's changes or include them in your commit. Use a separate worktree when isolation is
needed. Before committing, check `git log -1 --stat`: if another session has already committed changes, report this
and do not rewrite history. Do not create Git commits without an explicit user instruction.

When the user explicitly requests multiple agents, assign separate files to each and list prohibited actions.
Do not modify assigned files while their agent is working on them. Afterwards, review `git diff`, line endings,
unintended deletions, and checks. Compare the source branch against the current main branch.
Keep valuable untracked data at an absolute path in the main working directory.

## Deletion

Install dependencies separately. Before deleting anything, verify the absolute path, untracked data, and links to
`node_modules`. Never delete the main directory's dependencies through a link. Copy local settings only for checks
that require them. Do not store secrets in Git history.
