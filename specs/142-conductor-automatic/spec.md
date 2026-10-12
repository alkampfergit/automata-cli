# Feature Specification: conductor automatic mode

**Branch**: `feature/142-conductor-automatic` | **Issue**: #142 (part of epic #114)

## User Story

As the operator, I want `automata conductor` to run its tick again and again in one terminal, and to act on open Copilot review threads, so that I need no external cron and Copilot comments get fixed.

## Requirements

- FR-1: `automata conductor --automatic [--interval <seconds>]` runs the existing tick (`runConductor`) in a loop in the foreground. All tick output stays in the terminal.
- FR-2: `--interval` is a positive integer number of seconds. Default: 60. It needs `--automatic`; without it the command exits 1 with an error. `--automatic` cannot be used with `--check` or `--dry-run`.
- FR-3: Each iteration is a full tick (lock, prune, conduct, release lock). The loop waits `--interval` seconds between ticks. A tick that fails (exit 1) or finds the lock held does not stop the loop.
- FR-4: SIGINT and SIGTERM stop the loop after the current tick has released its lock.
- FR-5: The loop ends with exit code 0 when the watch list is empty after the prune. That includes an empty list at the start.
- FR-6: A watched pull request, or the pull request linked to a watched issue, with an unresolved review thread that Copilot started, is owed a turn when the newest such Copilot comment is newer than the newest conductor reply on that conversation (the reply marker). This holds even if the agent did not speak last.
- FR-7: A Copilot-triggered turn is not started while the run lock of the agent (`do-work`) is held. The tick logs why.
- FR-8: The loop-safety limits (`conductor.maxRepliesPerItem`, `conductor-blocked`) apply to a Copilot-triggered turn like to any other turn.
- FR-9: When the prompt is for a pull request with such threads, automata appends a block that lists each thread (file, line, URL, Copilot's comment) and tells the model to write in its reply an instruction to the agent to fix each comment and then resolve the thread. The conductor run stays read-only; it does not resolve threads itself.
- FR-10: `docs/conductor.md` and `CHANGELOG.md` (`Unreleased`) document the change. README does not change.

## Assumptions

- [AUTO] Interval default: 60 s, as the issue discussion agreed. No config key.
- [AUTO] "Close a comment" means resolve the review thread (agreed in the issue).
- [AUTO] The conductor is comment-only, so "fix" is an instruction in its reply to the agent; the agent edits code and resolves the thread.
- [AUTO] Agent "not working": the `do-work` run lock is free (agreed in the issue). The conductor lock is already exclusive per tick.
- [AUTO] Avoiding a repeat: a Copilot turn is owed only when Copilot wrote after the conductor's newest reply, so a thread the agent has not yet handled does not make the conductor post every interval. The reply limit is the second guard.
- [AUTO] Copilot account: a login that contains `copilot` (case-insensitive), for example `Copilot` or `copilot-pull-request-reviewer`.
- [AUTO] A failed or lock-held tick: logged, loop goes on. Options are validated before the loop starts. A pre-flight problem inside a tick is not told apart from a failed run, so it is logged and the next tick retries it.
