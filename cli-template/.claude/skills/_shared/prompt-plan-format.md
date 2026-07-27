# Prompt-plan format — the single source of truth

A **prompt-plan** is an implementation plan written as a prompt for an executor, human or agent. This file
defines how such a document is written. It is the only place where that format lives: `AGENTS.md` points here,
the `create-mcp-wizard` skill points here, the `feature-prompt-generator` skill points here. Change the format
here and it changes everywhere.

This file is **not a skill** — nothing auto-invokes it. Read it before writing a plan, then follow it.

## The rules

- **The plain-language block opens the document, and nothing goes above it.** The very first section under the
  `# ` title — ahead of the note to the executor, ahead of any description of how the system works today — is a
  block that tells a NON-PROGRAMMER what this plan changes and why. Everything technical — the state of the
  system today, the code map, the contract, the stages — starts only after it.

  **Structure it; never write a wall of text.** Break the block into short subsections, in this order, using
  the ones that carry meaning for this plan and dropping the rest:
  - *the problem* — what hurts today, from the point of view of the person affected;
  - *how things stand today* — how it behaves now, only where that is needed to see the problem;
  - *the solution* — what we do about it, one or two sentences per idea;
  - *what it will be like* — what a person will see or be able to do once the plan is carried out.

  Inside each subsection: short paragraphs of one to three sentences, a blank line whenever a new thought
  starts, and bullet lists for any enumeration. One long unbroken paragraph is a defect — the reader must be
  able to scan the block, not decipher it.

  Nothing technical belongs in this block: no file paths, no function, field or flag names, no protocol,
  specification or standard names, no abbreviation left unexpanded. If a term truly cannot be avoided, explain
  it in plain words in the same sentence. The test to apply: a reader must be able to decide whether this plan
  is worth doing without opening a single source file.

  The register to aim for: "Сегодня человек нажимает кнопку прямо в карточке, но бот об этом не узнаёт. На
  следующий вопрос он отвечает по устаревшей картине и уверенно описывает то, чего уже нет." Not one file name
  in it, and it still says exactly what changes.

- **The note to the executor comes immediately after**, second section, before anything technical. It carries
  the standing instructions for whoever carries the plan out — ticking the checklist, asking when a fork is not
  covered, and anything else the executor must keep in mind for the whole run.

- **Always include a checklist** of implementation stages, each item a `- [ ]` checkbox grouped by stage.

- **Tell the executor to tick the boxes as it goes.** Every plan carries an explicit instruction near the top
  that the executor (CLI agent or human) marks each checklist item `- [x]` in this same file the moment that
  item is genuinely done — so the document always reflects real progress, not intent. Make this a standing
  note, not a per-item reminder.

- **The last stage is always the documentation update** — the change is reflected in the docs.

- **Write in the target state, not as a transition.** State decisions as "We do it this way!", never as
  before/after. When a decision is "remove `search` completely", write the schema already without `search` —
  do NOT write "the `search` flag is now removed" or any "moved from X to Y" phrasing. No was/became wording
  inside the plan; the plan describes only the final state.

## Headings and language

Headings are written in the language of the document, alongside the rest of the prose. The two opening
headings are canonical and their Russian wording is fixed: in a Russian-language plan they read exactly
`## Суть` and `## Исполнителю (LLM)`, and the four subsections of the first block read `### Проблема`,
`### Текущее состояние`, `### Решение`, `### Как будет`. The skeleton below shows the English equivalents.

## The skeleton

```markdown
# <Plan title>

## Essence                        <!-- Russian: ## Суть -->

### The problem
<What hurts today, from the point of view of the person who will use this. Plain words only.>

### How things stand today
<Only as much as is needed to see the problem. Drop this subsection when the thing is brand new and there is
no "today" to describe.>

### The solution
<What we do about it — one or two sentences per idea.>

### What it will be like
<What a person will see or be able to do once the plan is carried out.>

## For the executor (LLM)         <!-- Russian: ## Исполнителю (LLM) -->

- Mark every checklist item `- [x]` in this file as soon as it is genuinely done — not when it is planned,
  not when it is half-written.
- When a decision is needed that this plan does not cover, ask the user instead of guessing.
- <Project-specific standing instructions: which docs to read before touching an unfamiliar API, which
  command to run after each meaningful change, which directories are off limits.>

## <Technical sections>

<Everything technical starts here and is shaped by the task: the scope, the contract, the interfaces, the
file-by-file change plan, code examples, test cases, execution commands. Order them so that a reader moves
from what is built to how it is verified.>

## Implementation checklist

### Stage 1 — <name>
- [ ] <item>
- [ ] <item>

### Stage 2 — <name>
- [ ] <item>

### Stage N — Documentation update
- [ ] <the docs that must reflect this change>

## Sign-off
- [ ] <the gates that must be green before the work is called done>
```

## Before releasing a plan

- The first section is the plain-language block, and nothing precedes it.
- That block contains no path, identifier, protocol name, or unexpanded abbreviation.
- The note to the executor is second and states the tick-the-boxes rule.
- Every stage item is a `- [ ]` checkbox and the stages are grouped.
- The last stage is the documentation update.
- Nowhere does the text describe a transition from an old state to a new one.
