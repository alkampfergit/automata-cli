# Plan

- `src/conductor/loopSafety.ts`: `canReply` parameter on `coveredByWatchedIssue`.
- `src/commands/conductor.ts`: `issueCanReply`, `coveredOf` takes `participants`, new `coveredNote` text.
- Tests: `tests/unit/conductorLoopSafety.test.ts`, `tests/unit/conductor.cmd.test.ts`.
- Docs: `docs/conductor.md`, `CHANGELOG.md`.
