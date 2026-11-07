# Model Instruction Rules

Read before creating or modifying model instructions, inputs, response schemas, or field descriptions.
Keep individual tasks in `llm-tasks/<task>/` within the relevant functional area: instructions in `prompt.md`, sample
input in `input.md`, the schema in `schema.ts`, and assembly in `task.ts`. In the library, keep shared Agent Tester
tasks under `src/core/agent-tester/`; in a generated project, use the directory of the corresponding service.

## Brevity and Rule Placement

Use the fewest words that preserve the requirements. Store each rule in one place: the instructions or a schema
field description. Describe a field's meaning and constraints in its `description`, and general constraints in the
instructions. If an explanation exceeds 1024 characters, move it to the instructions and leave a short reference.
When shortening text, remove repetition, obvious examples, and unnecessary negative examples before qualifications.
Check the effects of placement through repeated runs. In JSON descriptions, use multiline template literals with
one rule per line. Do not indent the text; preserve meaningful spaces.

## Inputs

Provide simple texts, dates, and object types as brief Markdown sections with clear headings.
Use JSON for nested structures, many similar records, measurement tables, and relationships between objects.
Do not make the model decode a dictionary of keys for a few simple texts.
Provide only information that affects the answer. Omit provenance, storage details, result recipients, and subsequent
processes unless they change the decision criteria. Do not include a person's name or job title when an object type
is sufficient. State evaluation criteria directly and briefly.

## Verification

Compare claims about inputs against the actual input builder. Instead of incorrectly claiming that dates are absent,
explain how to handle dates within the text. Test new wording repeatedly with examples involving paraphrases,
repetition, added statements of invariance, and changes in negation, degree, confidence, and dates.
Accept only consistently satisfactory results. Inspect the actual request, schema, and response through controlled
diagnostics. Do not disclose access keys.
