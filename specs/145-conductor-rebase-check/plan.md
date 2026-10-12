# Plan: conductor rebase check

- `src/conductor/alwaysChecks.ts` (pure): `ALWAYS_CHECKS`, `rebaseCheck`, `rebaseMarker`, `countRebaseTurns`, `hasRebaseFor`.
- `src/github/ghWorkService.ts`: `PullRequestRef.mergeable`/`headSha`; `getPrSurface` reads `mergeable,headRefOid`.
- `src/conductor/replyDecision.ts`: `Conversation.mergeable`/`headSha`; new decision kind `rebase`; skip reasons `rebase-limit`, `rebase-done`; `decideConductorReply` runs the always checks first; `LoopState.rebases`.
- `src/conductor/thread.ts`: rebase posting instruction (rebase marker, no reply marker).
- `src/config/configStore.ts`, `src/config/ConfigWizard.tsx`, `src/commands/config.ts` if it lists prompts: `conductor.prompts.rebase`, `DEFAULT_CONDUCTOR_REBASE_PROMPT`.
- `src/commands/conductor.ts`: run a rebase turn; marker note on `NEEDS-HUMAN`.
- `src/conductor/checkReport.ts`: show the rebase decision.
- Docs: `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`.
- Tests: `conductorAlwaysChecks.test.ts`, additions to thread, config and cmd tests.
