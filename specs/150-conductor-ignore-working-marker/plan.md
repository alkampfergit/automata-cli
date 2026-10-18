# Plan: conductor ignores the working marker

- `src/github/workingMarker.ts`: `WORKING_MARKER`, `isWorkingMarker()`.
- `src/commands/doWork.ts`: post `WORKING_MARKER`.
- `src/conductor/replyDecision.ts`: separate marker from real agent messages; `agent-working` skip; no Copilot turn then.
- `docs/conductor.md`, `CHANGELOG.md`; tests in `tests/unit/replyDecision.test.ts`.
