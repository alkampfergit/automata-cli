# Spec Decisions: Operation log for `do-work`

**Branch**: `feature/033-operation-log`
**Date**: 2026-09-10
**Spec**: [specs/033-operation-log/spec.md](../../specs/033-operation-log/spec.md)
**Plan**: [specs/033-operation-log/plan.md](../../specs/033-operation-log/plan.md)
**Research**: [specs/033-operation-log/research.md](../../specs/033-operation-log/research.md)

## Planning Decisions

- **Module placement**: A new `src/run/operationLog.ts` holding every constant,
  formatter and filesystem call, with `doWork.ts` keeping only one `recordTick`
  call and an `ItemReport` → `TickLogItem` mapper. **Rationale**: the retention
  rules are the part with real edge cases and are only unit-testable as pure
  functions in a module that needs no `gh` mocking; `doWork.ts` is already 1468
  lines, and `src/run/` already holds `runLock.ts`, the sibling per-run runtime
  concern. **Alternatives considered**: inlining in `doWork.ts` (every retention
  test would need a full mocked tick); a generic pluggable logging abstraction
  (rejected under Principle V — one producer, two files).

- **Execution-line format**: Space-separated `key=value` fields on one line,
  with all five outcome buckets always emitted even at zero. **Rationale**: the
  requirement is "one line for each run, brief"; this is readable under
  `tail -f`, greppable (`grep 'exit=2'`), and unambiguous — an absent key would
  read as "an older automata" rather than "zero", the same reasoning
  `summarize()` already uses for printing the executor unconditionally.
  **Alternatives considered**: JSON Lines (verbose for a human-first file);
  omitting zero buckets (makes absence ambiguous).

- **Write ordering**: Append the new entry first, then read back and apply
  retention, rewriting only when retention actually removed something.
  **Rationale**: the newest entry must survive a failed rewrite, and the common
  path stays a single `O_APPEND` write — atomic for a short line, which matters
  because two checkouts under one parent share the files. **Alternatives
  considered**: trim-then-append (a crash between the two loses the new entry);
  rewrite-always (a 150 KB read+write every tick for no benefit).

- **Atomic replace**: Retention rewrites go to `<file>.<pid>.tmp` and are
  `renameSync`d over the target. **Rationale**: `rename(2)` within a directory
  is atomic, so a reader never sees a half-written log and a crash leaves the
  previous complete file; `runLock.ts` already establishes this idiom in the
  repo, and the pid in the temp name avoids collisions between concurrent
  checkouts. **Alternatives considered**: in-place `writeFileSync` (exposes a
  truncated log to a concurrent reader).

- **Failure containment**: Both an `accessSync(dir, W_OK)` pre-check and a
  blanket `try`/`catch` around the whole of `recordTick`, with the catch
  completely silent. **Rationale**: the pre-check is what the issue asked for
  and is the cheap path for a deliberately locked-down parent, but `access` is
  advisory — it does not cover foreign file ownership, a full disk, a
  remount, or an ENOENT parent, so the catch is what actually guarantees FR-008.
  Silence is chosen because a warning on every tick of a five-minute cron is
  noise in the very output the log exists to replace. **Alternatives
  considered**: catch-only (creates files in directories the operator locked
  down); check-only (TOCTOU gap that could take down an unattended loop);
  warn-once-per-process (a `do-work` process runs one tick, so that is every
  tick).

- **Definition of "actually performs something"**: `ranExecutor === true`.
  **Rationale**: the codebase already has this flag and already trusts it for
  something consequential — it is what `--max-runs` counts — so the work log and
  the run cap can never disagree. **Alternatives considered**:
  `outcome === "answered"` (a run that invoked the executor and then failed did
  perform something, and is exactly what a monthly review wants to see); any
  non-empty report list (a tick where every item was skipped for a dirty tree
  performed nothing).

- **Retention window**: A rolling 30 days measured from the record's header
  timestamp, with unparseable headers kept rather than dropped. **Rationale**: a
  calendar-month boundary deletes up to four weeks of history in one step on the
  first of the month, precisely when someone asking "what happened last week" is
  reading; and silently deleting content automata cannot interpret would turn a
  formatting bug into data loss. **Alternatives considered**: previous calendar
  month; dropping unparseable records.

- **Which invocations log**: A run blocked by the run lock writes a line with
  `note=lock-held`; a run interrupted by SIGINT/SIGTERM writes nothing.
  **Rationale**: a loop wedged behind a stale lock does nothing every tick, and
  without a line that is indistinguishable from cron having stopped — the exact
  failure this log exists to expose. The signal path already ends in
  `process.exit(130)` after terminating the child, and adding filesystem work to
  a shutdown racing a killed executor buys one line at the cost of a slower,
  more fragile shutdown. **Alternatives considered**: logging on the signal path
  too; skipping the lock-held line (hides the most common stuck state).

- **`runTick` signature**: Widened to return `{ exitCode, reports }`.
  **Rationale**: logging must happen after the `finally` that releases the lock
  (so the write cannot extend the lock's lifetime) and must also cover the
  `catch` that turns a thrown tick into exit 1 — both live in the action, so the
  action needs the reports. **Alternatives considered**: logging inside
  `runTick` (cannot cover a thrown tick, and fires while the lock is still
  held); a module-level `lastReports` (invisible state next to the existing
  `inFlightMarker`).

- **Project structure**: Single project, flat modules — `src/run/operationLog.ts`
  next to `src/run/runLock.ts`, tests in `tests/unit/`, documentation in
  `docs/do-work.md`. **Rationale**: matches the existing layout and Principle V's
  preference for a flat structure over new nesting. **Alternatives considered**:
  a new `src/logging/` directory for a single module.
