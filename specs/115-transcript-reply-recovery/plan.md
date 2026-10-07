# Plan

- `src/run/secondOpinion.ts`: extract `runModelOnce` (headless, tool-less call) from `scrubExcerpt`.
- `src/run/answerRecovery.ts`: prompt, output interpretation, transcript tail reader, `recoverAnswer`.
- `src/commands/doWork.ts`: `runRecorded` returns a `recovery` closure; `reconcileMarker` calls `attemptRecovery`
  before `reportNoAnswer`, which appends the failure reason.
- Docs: `docs/do-work.md`, `docs/wiki/Troubleshooting.md`, `CHANGELOG.md`.
