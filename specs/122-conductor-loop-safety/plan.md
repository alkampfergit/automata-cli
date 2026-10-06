# Plan: conductor loop safety

- `src/conductor/loopSafety.ts` (pure): marker, label and limit constants, `countConductorReplies`, `parseNeedsHuman`, `maxRepliesProblem`, `resolveMaxReplies`.
- `src/conductor/replyDecision.ts`: skip reasons `blocked` and `limit`; `decideConductorReply` takes the loop-safety state.
- `src/conductor/thread.ts`: posting and dry-run instructions name the marker and the `NEEDS-HUMAN` line.
- `src/github/ghWorkService.ts`: `WatchTarget.labels`; `addLabel`.
- `src/commands/conductor.ts`: read the label, pass the state to the decision, capture stdout of a live run, apply the label on `NEEDS-HUMAN`.
- `src/config/configStore.ts`: `conductor.maxRepliesPerItem`.
- Docs: `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`.
- Tests: `conductorLoopSafety.test.ts`, additions to `conductor.cmd.test.ts`, `conductorThread.test.ts`, `ghWorkService.test.ts`.
