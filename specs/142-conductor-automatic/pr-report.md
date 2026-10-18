# PR Report: conductor automatic mode

**Branch**: `feature/142-conductor-automatic`
**Date**: 2026-10-12
**Spec**: specs/142-conductor-automatic/spec.md

## Summary

`automata conductor` can now run on its own in one terminal, so no external cron is needed. It also notices open
Copilot review comments and tells the agent to fix them and resolve the threads.

## What's New

- **`--automatic` and `--interval <seconds>`**: the tick runs in a loop (default 60 s); the loop exits 0 when the watch list is empty after the prune, also at the start; Ctrl+C stops it after the current tick (`src/conductor/automatic.ts`, `src/commands/conductor.ts`).
- **Copilot threads**: an unresolved Copilot thread owes a turn when Copilot wrote after the newest conductor reply; the prompt gets a block that asks the model to tell the agent to fix and resolve (`src/conductor/copilot.ts`, `replyDecision.ts`, `thread.ts`).
- **Agent working**: a Copilot turn waits while the `do-work` run lock is held. Reply limit and `conductor-blocked` still apply.
- **Docs**: `docs/conductor.md`, `CHANGELOG.md`.

## Testing

- **Unit**: interval parsing, the loop (exit, retry, stop), Copilot detection, the decision and the prompt block.
- **Command**: option errors, empty list, loop that waits then ends, Copilot turn with the `do-work` lock held and free.
- `npm test && npm run lint` pass.

## Notes

- The conductor stays read-only, so it cannot resolve threads; the agent does.
- A pre-flight error inside a tick is logged and retried by the loop.

Closes #142
