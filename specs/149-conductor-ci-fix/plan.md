# Plan: conductor CI-fix check

- `src/conductor/alwaysChecks.ts`: shared agent-marker helpers; `ciFixCheck`, `ciFixMarker`, `countCiFixTurns`, `hasCiFixFor`; skip reasons `ci-fix-done`, `ci-fix-limit`; decision kind `ci-fix`.
- `src/conductor/replyDecision.ts`: `Conversation.ciFailed`/`ciPending`; `prConversation(surface, checks?)`; `LoopState.ciFixes`/`maxCiFixes`/`ciFixEnabled`.
- `src/conductor/thread.ts`: posting instruction for a request turn (marker and wording for rebase or CI fix).
- `src/config/configStore.ts`, `src/config/ConfigWizard.tsx`, `src/commands/config.ts`: `conductor.prompts.ciFix`, `conductor.ciFix.enabled`, `DEFAULT_CONDUCTOR_CI_FIX_PROMPT`.
- `src/commands/conductor.ts`: run a CI-fix turn; marker note on `NEEDS-HUMAN`; `src/conductor/checkReport.ts`: show it.
- Docs: `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`. Tests: `conductorAlwaysChecks.test.ts`, `conductor.cmd.test.ts`, thread and config tests.
