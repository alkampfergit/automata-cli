# Transcript-based reply recovery

## Summary

When a `do-work` run prints its answer but never posts it, automata now recovers the answer from the run transcript, posts it and verifies it. Any failure keeps the previous notice and says why recovery did not help.

## What's New

- Recovery pass (`src/run/answerRecovery.ts`) using the run's executor, wired in before the no-answer notice.
- `runModelOnce` extracted from the second-opinion module.

## Testing

- Unit: prompt/output/transcript tail; `do-work` recovery, no-duplicate, empty, executor failure, post failure, read-back failure, failed run, `postRunLog: false`.
