# Plan: conductor reply decision

- `src/conductor/replyDecision.ts` (pure): `Conversation`, `issueConversation`, `prConversation`, `decideConversation`, `decideConductorReply`, `isWatchClosed`.
- `src/commands/conductor.ts`: `pruneWatchList` uses `isWatchClosed`.
- Docs: `docs/conductor.md` section on the reply rule.
- Tests: `tests/unit/replyDecision.test.ts`.
