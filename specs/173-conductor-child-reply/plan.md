# Plan

- `src/conductor/childStart.ts` (pure): `classifyChildThread(messages, participants)` returns `empty`,
  `waiting` or `agent-last`.
- `src/conductor/storyRunner.ts`: `startChild` is async; it reads the child comments and calls an injected `ChildTurn`
  for `agent-last`. `conductStories` is async.
- `src/commands/conductor.ts`: `replyToChild` composes the thread with `conductor.prompts.child` and runs the model
  (live: `conductReply`; dry run: `runModelForText`).
- `src/config/configStore.ts`, `src/commands/config.ts`: the `child` prompt key and its default.
- Tests: `tests/unit/childStart.test.ts`.
