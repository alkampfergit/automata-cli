# Plan: Azure DevOps unresolved PR threads
- `src/config/azdoService.ts`: `getPrComments(branch)` (list → comments → map/filter).
- `src/git/gitService.ts`: `getPrComments` delegates to it in azdo mode; drop the `"unsupported"` result.
- `src/commands/git.ts`, `src/commands/executePrompt.ts`: drop the unsupported branches and help note.
- Tests: `tests/unit/azdoService.test.ts` + `tests/fixtures/azdo/pr-comments.json`; command-level tests updated.
- Docs: `docs/git.md`, `docs/azdo-gap.md`, `docs/execute-prompt.md`, `CHANGELOG.md`.
