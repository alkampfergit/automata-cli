# Plan: conductor automatic mode

- `src/conductor/copilot.ts` (pure): `isCopilotAuthor`, `openCopilotThreads(surface)`, `newestCopilotAt`, `renderCopilotBlock`.
- `src/conductor/replyDecision.ts`: `Conversation.copilotAt`; `decideConversation` returns a `reply` for a Copilot turn owed; `prConversation` fills it.
- `src/conductor/thread.ts`: append the Copilot block for each pull request with open Copilot threads.
- `src/conductor/automatic.ts` (pure + timer): `parseInterval`, `runAutomatic(tick, remaining, sleep, signal)`.
- `src/commands/conductor.ts`: `--automatic`, `--interval`; the tick reports whether the watch list is empty; skip a Copilot-only turn while the `do-work` lock is held.
- Docs: `docs/conductor.md`, `CHANGELOG.md`.
- Tests: `conductorCopilot.test.ts`, `conductorAutomatic.test.ts`, additions to `replyDecision.test.ts`, `conductorThread.test.ts`, `conductor.cmd.test.ts`.
