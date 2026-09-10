# PR Report: Operation log for `do-work`

**Branch**: `feature/033-operation-log`
**Date**: 2026-09-10
**Spec**: [specs/033-operation-log/spec.md](../../specs/033-operation-log/spec.md)

## Summary

An operator running `automata do-work` from cron has no durable record of the
loop: when it silently stops working there is nothing to look at, because cron's
output was discarded. This adds two plain-text diagnostic files in the directory
above the checkout — `automata-execution.log`, one line per invocation capped at
the newest 1000 lines, and `automata-work.log`, one record per invocation that
actually ran the executor, pruned to the last 30 days. Both are best-effort: if
the directory is not writable, or any write fails, the tick behaves exactly as
it does today.

## What's New

- **`src/run/operationLog.ts` (new)**: the whole feature — file locations,
  both formats, both retention rules and the only filesystem calls. Placed next
  to `runLock.ts`, the sibling per-run runtime concern, so the retention logic
  is unit-testable as pure functions without mocking the `gh` CLI.
- **`automata-execution.log`**: one `key=value` line per non-dry-run `do-work`
  invocation — timestamp, command, repo slug, item count, all five outcome
  counts, executor runs, exit code and duration. Trimmed to the newest 1000
  lines after each append. Written even when the tick found nothing, so an
  idle loop is visibly idle rather than absent.
- **`automata-work.log`**: one record per invocation in which the executor was
  actually invoked, listing exactly those items with issue, turn, outcome,
  resolved executor/model/effort and a 200-character detail. Records older than
  30 days are dropped on append. `ranExecutor === true` is the membership test,
  which is the same flag `--max-runs` counts — so the log and the run cap can
  never disagree about whether a tick did work.
- **Log location**: `path.dirname(process.cwd())`, not configurable. Several
  checkouts under one workspace root share the files; the repo slug on every
  entry keeps them apart.
- **Failure containment**: an `accessSync(dir, W_OK)` pre-check plus a blanket
  silent `catch` around `recordTick`. Nothing here can change stdout, the
  `--json` payload or the exit code — including when the parent is read-only,
  missing, or the existing work log is unparseable.
- **`src/commands/doWork.ts`**: `runTick` now returns `{ exitCode, reports }`
  so the action can log after the `finally` that releases the lock (a log write
  must not extend the lock's lifetime) and can also log a tick that threw. A
  run turned away by the run lock logs `note=lock-held`; `--dry-run` logs
  nothing.
- **`docs/do-work.md`**: a new "The operation log" section with both grammars,
  a field table, worked `grep`/`awk` queries, the permission behaviour and the
  known limits, cross-referenced from "Running under cron".

## Testing

- **Unit — `tests/unit/operationLog.test.ts` (32 tests)**: `formatExecutionLine`
  (all five buckets emitted at zero, `repo=-`, the `note=` suffix, one-decimal
  duration, exactly one line); `formatWorkRecord` (null when nothing ran, only
  invoked items listed, executor rendering, newline collapsing, truncation at
  200 characters); `trimToLastLines` (below/at/above the limit, the 1000-line
  boundary, content with and without a trailing newline); `pruneOldRecords` (a
  40-day record dropped and a 5-day one kept, preamble preserved, an unparseable
  header kept, no-op when everything is recent); and `recordTick` against a
  temporary directory (both files created, appends accumulate, no work log when
  nothing ran, an existing work log left untouched, the 1000-line cap held, old
  records pruned, no temp file left behind).
- **Unit — failure paths**: a missing directory and a `chmod 0555` directory
  both return without throwing and create nothing; an unparseable existing work
  log still accepts an append.
- **Unit — `tests/unit/doWork.cmd.test.ts` (8 new tests)**: the wiring — an
  answered tick records the resolved executor; an empty tick still records; a
  deferred item records `ranExecutor: false`; a thrown tick records `exit=1`; a
  lock-held run records `note: "lock-held"`; an unresolvable slug records
  `repo: null`; `--dry-run` records nothing; and the `--json` payload keys are
  unchanged.
- **Mutation-verified**: removing the lock-held call and adding a dry-run call
  each turn exactly one test red, confirming those two guards are really
  guarded rather than vacuously green.
- **Manual**: `recordTick` driven directly against a temp directory produced
  output byte-identical to the documented examples, and a `chmod 0555`
  directory produced no files and no throw. The built bundle was run as
  `do-work --dry-run` from a temporary checkout: exit unchanged, no log file
  created in its parent.
- **Gates**: `npm test` — 839 passed / 29 files. `npm run lint` (`eslint src/`)
  — clean. `tsc --noEmit -p tsconfig.json` — clean. Both new/changed test files
  typechecked explicitly (`tsconfig.json` covers only `src/`); the one error in
  `doWork.cmd.test.ts` is the pre-existing `ReviewThread` fixture at line 689.
  `prettier --check` passes on both new files.

## Notes

- **No configuration.** Neither the directory nor the two retention limits are
  configurable, and there is no opt-out. Deliberate under the constitution's
  Simplicity principle; easy to add later if an operator asks.
- **An interrupted tick writes no line.** `SIGINT`/`SIGTERM` exits from the
  signal handler before the tick returns, and adding filesystem work to a
  shutdown that is racing a killed executor was judged not worth one log line.
  Documented in `docs/do-work.md`.
- **Concurrent trim can lose a line.** Two checkouts under one parent share the
  files; when one crosses the 1000-line boundary its rewrite can drop a line the
  other just appended. Accepted for a diagnostic log, and documented.
- **Only `do-work` logs.** `implement-next`, `execute`, `execute-prompt` and the
  `git` subcommands are untouched.
- `README.md` is unchanged — no new command, flag, install step or dev-setup
  change, and its `do-work` row already links to `docs/do-work.md`.
