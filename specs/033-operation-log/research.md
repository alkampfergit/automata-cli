# Research: Operation log for `do-work`

**Feature**: `feature/033-operation-log` | **Date**: 2026-09-10

## Decision: a new `src/run/operationLog.ts`, not inline in `doWork.ts`

**Decision**: Put every constant, formatter and filesystem call in a new module
under `src/run/`, and leave `doWork.ts` with one `recordTick(...)` call plus a
`toTickLogItem` mapper.

**Rationale**: `doWork.ts` is already 1468 lines. The retention rules are the
part of this feature with real edge cases (a 1000-line boundary, a 30-day cut,
an unparseable file), and they are only unit-testable if they are pure functions
in a module that does not need the `gh` CLI mocked. `src/run/` already holds
`runLock.ts`, the other per-run runtime concern that writes a file outside the
normal source flow, so this is the established neighbourhood.

**Alternatives considered**:

- *Inline in `doWork.ts`*: rejected — every retention test would have to drive a
  full mocked tick, and the constitution's Single Responsibility principle
  pushes shared/mechanical logic out of command files.
- *A generic logging abstraction* (`Logger` interface, pluggable sinks):
  rejected under Principle V. There is one producer and two files.

## Decision: `key=value` fields on one line, not JSON-per-line

**Decision**: `2026-09-10T06:51:36.123Z do-work repo=owner/name items=2 answered=1 answered-no-reply=0 skipped=0 failed=0 deferred=1 runs=1 exit=2 dur=42.1s`

**Rationale**: The requirement is "one line for each run, brief". This is
readable by eye in `tail -f`, greppable (`grep 'exit=2'`), and still trivially
parseable. Keys are always present even at zero, so `grep -c 'runs=0'` is a
meaningful query rather than depending on whether a bucket was emitted.

**Alternatives considered**:

- *JSON Lines*: rejected — verbose for a file whose primary consumer is a human
  running `tail`, and the stated requirement is brevity.
- *Omit zero buckets*: rejected — makes absence ambiguous between "zero" and
  "an older automata that did not emit this field", the same reasoning the
  existing `summarize()` uses for printing the executor unconditionally.

## Decision: append first, then trim/prune

**Decision**: `appendFileSync` the new content, then read the file back and
rewrite it only if retention actually removes something.

**Rationale**: The newest entry is the one most likely to matter, so it must be
durable even if the rewrite fails. Appending first also keeps the common path a
single `O_APPEND` write, which is atomic for a short line and therefore safe
when two checkouts under the same parent directory log concurrently.

**Alternatives considered**:

- *Trim then append*: rejected — a crash between the two loses the new entry
  and keeps a stale one.
- *Rewrite always*: rejected — turns every tick into a full read+write of up to
  150 KB for no benefit, and widens the window in which a concurrent append can
  be lost.

## Decision: rewrite via temp file + `renameSync`

**Decision**: When retention removes content, write the survivors to
`<file>.<pid>.tmp` in the same directory and `renameSync` it over the target.

**Rationale**: `rename(2)` within a directory is atomic, so a reader never sees
a half-written log and a crash mid-rewrite leaves the previous complete file.
`runLock.ts` already uses `renameSync` for exactly this reason, so the idiom is
established. Including the pid in the temp name keeps two concurrent
repositories from colliding on it.

**Alternatives considered**:

- *`writeFileSync` in place*: rejected — a crash or a concurrent read during the
  write leaves or exposes a truncated log.

## Decision: `fs.accessSync(dir, W_OK)` pre-check plus a blanket `try`/`catch`

**Decision**: Both. Check the directory first, and wrap the entire `recordTick`
body in one `try`/`catch` that discards the error.

**Rationale**: The pre-check is what the issue asked for ("check permission to
write") and is the cheap path for the common case of a read-only parent — no
file is created and no error object is allocated. But `access` is advisory: it
does not cover a file that exists with different ownership, a full disk, a
read-only remount between the check and the write, or an ENOENT parent. The
catch is what actually guarantees FR-008. Neither alone is sufficient.

**Alternatives considered**:

- *Catch only*: rejected — would attempt to create files in directories the
  operator has deliberately locked down, and the issue explicitly asks for the
  check.
- *Check only*: rejected — a TOCTOU gap on an unattended loop is exactly the
  kind of failure that must not take the tick down.

## Decision: the catch is completely silent

**Decision**: The failure path writes nothing at all, not even a stderr warning.

**Rationale**: The issue says "just ignore writing those files". A warning
emitted on every tick of a five-minute cron in a read-only workspace is pure
noise in the very output the log exists to replace. Nothing downstream depends
on the log existing, so a silent skip cannot mislead.

**Alternatives considered**:

- *Warn once per process*: rejected — a `do-work` process runs one tick, so
  "once per process" is "every tick".
- *Warn on stderr*: rejected as above; `progress()` output is what the operator
  is already discarding.

## Decision: `ranExecutor === true` is the definition of "actually performs something"

**Decision**: A tick writes to `automata-work.log` iff at least one
`ItemReport` has `ranExecutor === true`, and the record lists exactly those
items.

**Rationale**: The codebase already has this concept and already trusts it for
something consequential — it is what the `--max-runs` cap counts, with the
comment "True only when the executor was actually invoked". Reusing it means the
work log and the run cap can never disagree about whether a tick did work.

**Alternatives considered**:

- *`outcome === "answered"`*: rejected — a run that invoked the executor and
  then failed did perform something, and is precisely what an operator reviewing
  the month wants to see.
- *Any non-empty report list*: rejected — a tick where every item was skipped
  for a dirty tree performed nothing.

## Decision: rolling 30 days, cut on the header timestamp

**Decision**: "last month" = `now - 30 * 24 * 60 * 60 * 1000`. A record whose
header timestamp does not parse is kept, not dropped.

**Rationale**: A calendar-month boundary deletes up to four weeks of history in
a single step on the first of the month, which is when an operator investigating
"what happened last week" is most likely to be reading. Keeping unparseable
records is the conservative choice: FR-008 forbids throwing, and silently
deleting content automata cannot interpret is worse than leaving it.

**Alternatives considered**:

- *Previous calendar month*: rejected as above.
- *Drop unparseable records*: rejected — turns a formatting bug into data loss.

## Decision: a lock-held invocation logs; an interrupted one does not

**Decision**: `reportLockHeld` produces an execution line with `note=lock-held`.
A SIGINT/SIGTERM tick produces no line.

**Rationale**: A loop wedged behind a stale lock does nothing every tick, and
without a line that is indistinguishable from cron having stopped — the exact
failure the execution log exists to expose. The interrupted case is different:
the signal handler already ends in `process.exit(130)` after terminating the
child, and adding filesystem work to a shutdown path that is racing a killed
executor buys a log line at the cost of a slower, more fragile shutdown.
Documented as a known gap instead.

**Alternatives considered**:

- *Log on the signal path too*: rejected as above; revisit if operators report
  missing lines.
- *Skip the lock-held line*: rejected — hides the most common stuck state.

## Decision: `runTick` returns `{ exitCode, reports }`

**Decision**: Widen the return type rather than logging inside `runTick` or
hoisting `reports` into module scope.

**Rationale**: The `finally` that releases the lock must run before logging (the
log write must not extend the lock's lifetime), and the `catch` that turns a
thrown tick into exit 1 needs to log too. Both live in the action, so the action
needs the reports. A widened return value is explicit; a module-level mutable
would be another piece of hidden state next to the existing `inFlightMarker`.

**Alternatives considered**:

- *Log inside `runTick`*: rejected — cannot cover the thrown-tick case and would
  fire before the lock is released.
- *Module-level `lastReports`*: rejected — invisible coupling, and the file
  already carries one such variable whose comment explains why it was
  unavoidable there.

## Verified facts

- `ItemReport` (`src/commands/doWork.ts:107`) carries `ranExecutor?: boolean`
  and an optional `execution: ResolvedExecution` with `executor`, `model`,
  `effort`. `toItemJson` already flattens these for `--json`; the log mapper
  mirrors it.
- `Outcome` is `"answered" | "answered-no-reply" | "skipped" | "failed" |
  "deferred"` — five buckets, not four.
- `getRepoSlug()` (`src/github/ghWorkService.ts:193`) shells out to `gh` and can
  throw; the log's repo field is therefore resolved inside the `try`.
- `renameSync` is already imported and used by `src/run/runLock.ts`, confirming
  the atomic-replace idiom for this repo.
- `.gitignore` already ignores `*.log`, and the files live outside the checkout
  regardless, so no `.gitignore` change is required.
