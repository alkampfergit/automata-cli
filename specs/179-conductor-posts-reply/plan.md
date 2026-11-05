# Plan

- `src/conductor/thread.ts`: `replyInstruction` replaces `postingInstruction`; new `replyMarkerFor(request)`.
- `src/github/ghWorkService.ts`: new `postComment(target, body)` (`gh <issue|pr> comment <n> --body-file -`, stdin).
- `src/commands/conductor.ts`: `runModel` runs the model without `replyTo`, extracts the reply with
  `extractDryRunReply`, then posts it unless it is `NEEDS-HUMAN:`; empty output throws.
- Tests: `conductor.cmd.test.ts`, `conductorThread.test.ts`, `conductorLoopSafety.test.ts`, `ghWorkService.test.ts`.
- Docs: `docs/conductor.md`, `CHANGELOG.md`.
