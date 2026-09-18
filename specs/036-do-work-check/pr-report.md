# PR Report: `do-work --check` — a read-only health report for the autonomous loop

**Branch**: `feature/036-do-work-check`
**Date**: 2026-09-18
**Spec**: [specs/036-do-work-check/spec.md](./spec.md)

## Summary

`do-work` runs from a scheduler and discards its own stdout, so when the loop quietly
stops picking work up there is nowhere to look. This adds `automata do-work --check`: a
read-only report that answers, in one command, whether a tick is running, whether the
scheduler is still firing, what the last runs did, whether the checkout is in a state that
permits work, why each candidate issue is or is not being picked up, and whether the
configuration, `gh` and the executor are sound. It exits `0` when it found no problem and
`1` when it did.

## What's New

- **`do-work --check`** — six fixed sections (`Run lock`, `Recent ticks`, `Last work`,
  `Repository`, `Selection`, `Environment`) plus a problem list and a `RESULT:` verdict.
  Every section prints even when it has nothing to say, and a section that fails to
  collect reports the failure instead of aborting the report.
- **`do-work --no-fetch`** — makes `--check` run with **no network call at all**: no
  `git fetch` and no `gh`. Ahead/behind is then labelled `(not refreshed)` and the
  selection section reports that it did not run, which is not itself a problem.
- **`inspectRunLock()` (`src/run/runLock.ts`)** — classifies the lock as
  free/held/suspect/stale/unreadable *without acquiring it*, reusing the module's own
  `isStale`/`heldTooLong` so a report and a tick cannot disagree about one lock file. A
  live in-window lock is deliberately **not** a problem: a tick in flight is the normal
  state of a scheduled loop.
- **The read side of the operation logs (`src/run/operationLog.ts`)** —
  `readExecutionTicks()` and `readWorkRecords()` parse back what `formatExecutionLine()`
  and `formatWorkRecord()` write, filtered to this repository's slug, newest first, with
  malformed entries skipped and counted rather than thrown over.
- **Scheduler-silence detection (`src/run/checkReport.ts`)** — derived from the execution
  log itself: the median interval between recorded ticks, flagged when the newest tick is
  older than three times that median, and withheld entirely until three intervals exist.
  No cron file, no cron log, no process table, and no new configuration key — the cron
  interval belongs to the host.
- **`src/git/repoStatus.ts`** — a read-only git diagnosis (branch, detached HEAD, dirty
  paths, base branch locally and upstream, ahead/behind) whose only permitted write is one
  `git fetch` of the base branch's remote-tracking ref. Deliberately *not* the pre-flight:
  `runRepoHygiene`'s dry-run mode describes the mutations it would perform, not the state
  of the checkout.
- **`src/run/checkReport.ts`** — the report model (sections, problems, verdict) and both
  renderers, as pure functions, so every acceptance scenario is a unit test that needs no
  git, no `gh` and no filesystem.
- **A non-exiting settings path (`src/commands/doWork.ts`)** — `resolveSettings` is split
  into `resolveSettingsResult`, which returns the error instead of calling `process.exit`.
  `do-work` itself is unchanged: it catches and routes straight back into `fail()`, with
  the same messages and the same `config-error` log line. `checkAuthenticatedIdentity`
  becomes `describeIdentityProblem`, returning the reason so `--check` can report the
  self-triggering-loop misconfiguration that a tick refuses to run under.

## Breaking Changes

None. `--check` and `--no-fetch` are new flags; no existing flag, config key, output
format or exit code changed.

## Testing

- **Unit — `tests/unit/doWorkCheck.cmd.test.ts` (17 tests)**: section order; `--check` +
  `--dry-run` refused; **nothing written** (asserts `acquireRunLock`, `recordTick`,
  `runRepoHygiene`, `prepareBaseBranch`, `preparePrBranch`, `addClosesRefToPr`,
  `runClaude`, `runCodex` and all five GitHub writes are never called); a `gh` failure
  confined to its section; an invalid configuration reported as a finding with the other
  sections still printed; the base-branch fallback when the config cannot be read at all;
  `--no-fetch` suppressing both the fetch and every `gh` call; `--issue` narrowing the
  selection; a self-triggering `gh` identity reported rather than exited; exit `0` vs `1`;
  `--json` parseable and carrying the plan in `--dry-run --json`'s shape.
- **Unit — `tests/unit/checkReport.test.ts` (44 tests)**: the cadence heuristic (median
  over mean, the three-interval floor, both sides of the `3 ×` boundary, a zero gap);
  problem attribution per section including every case that deliberately is *not* a
  problem (a live lock, an idle loop, an empty work log, a branch other than the base, a
  base branch only ahead or only behind); section ordering; the verdict line for both exit
  codes; the JSON shape against the contract.
- **Unit — `tests/unit/repoStatus.test.ts` (12 tests)**: clean/level, dirty with the lock
  file excluded, detached HEAD, missing base branch, upstream fallback, `--left-right`
  ahead/behind ordering, unparseable `rev-list` output, fetch off, fetch failed, not a
  repository. Every test asserts the **argv**, and a shared assertion fails the suite if
  any mutating git subcommand is ever issued — the module's read-only promise is only
  worth what the tests assert.
- **Unit — `tests/unit/operationLog.read.test.ts` (17 tests)**: round-trips
  `formatExecutionLine` → `readExecutionTicks` and `formatWorkRecord` → `readWorkRecords`,
  so a renamed field fails here rather than showing up as a report full of zeroes; plus
  slug filtering, the two-token `PR #61` subject, a line from an older automata, malformed
  entries, and absent vs empty logs.
- **Unit — `tests/unit/runLock.test.ts` (+8 tests)**: each `inspectRunLock` variant, and
  that inspecting leaves the directory byte-identical and creates no lock file.
- **Gate**: `npm test` — 1192 tests across 38 files, all passing. `npm run lint` clean.
  `npm run build` clean.
- **Manual**: `node dist/index.js do-work --check` in this checkout, making real `gh`
  calls — it correctly reported issue #75 as "nothing new since the agent's message" and
  #76 as pickable. Verified against the quickstart that the working tree, the execution
  log and the lock file were byte-identical before and after, and that
  `--check --no-fetch --json` emits one parseable document with
  `selection.data.ran === false` and `git.data.refreshed === false`.

## Notes

- Three things the issue's shell script does that `--check` deliberately does **not**:
  inspect cron (`/etc/cron.d/...`, the cron runner, the cron log), scan the process table
  with `pgrep`, and offer `--repair`. The first two are one host's specifics and would be
  wrong on every other; the scheduler-silence check covers the same failure
  host-agnostically. `--repair` is out because a diagnostic you cannot safely run while
  worried is not a diagnostic — `do-work`'s own pre-flight already fast-forwards and
  rescues.
- The `3 ×` median multiplier and the history window (20 ticks, 3 work records) are
  judgement calls, recorded as assumptions in the spec. If a host's cadence proves too
  bursty for them, a config key is the natural follow-up — it was rejected here because the
  installation that most needs the diagnostic is the one that never set it.
- `prettier --check` still fails on `src/commands/doWork.ts` and `src/run/runLock.ts`. Both
  were already failing on `develop` before this branch (verified by stashing); the new
  files and the new `src/run/operationLog.ts` content are formatted. Reformatting those two
  in full would bury the feature diff, and `npm test && npm run lint` is the gate per
  `AGENTS.md`.
