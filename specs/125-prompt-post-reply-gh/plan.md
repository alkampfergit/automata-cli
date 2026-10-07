# Plan: Explicit reply-posting instruction

- `src/config/configStore.ts`: append a paragraph to `DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT`.
- `.automata/do-work-issue-discuss.md`: same instruction.
- Tests: assertions in `tests/unit/configStore.test.ts`. Docs: `docs/wiki/Prompts.md`, `CHANGELOG.md`.
