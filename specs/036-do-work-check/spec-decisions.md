# Spec Decisions: `do-work --check` — a read-only health report for the autonomous loop

**Branch**: `feature/036-do-work-check`
**Date**: 2026-09-18
**Spec**: [specs/036-do-work-check/spec.md](./spec.md)
**Plan**: [specs/036-do-work-check/plan.md](./plan.md)
**Research**: [specs/036-do-work-check/research.md](./research.md)

## Planning Decisions

- **Classifying the run lock**: add `inspectRunLock()` to `src/run/runLock.ts`, reusing
  the module's existing `readOwner` / `isStale` / `heldTooLong`. **Rationale**: those three
  already encode the judgement `acquireRunLock` makes, so the check cannot form a second
  opinion about the same file. **Alternatives considered**: calling `acquireRunLock` and
  releasing immediately (writes the lock file and momentarily turns away a real tick); a
  `pgrep`-style process scan as in the script the issue supplied (cannot see an orphaned
  lock, not portable).

- **Reading the operation logs**: add `readExecutionTicks()` / `readWorkRecords()` to
  `src/run/operationLog.ts`, beside the formatters that write those lines.
  **Rationale**: one module owns the format, and the tests round-trip the writer's output
  through the reader, so a field rename cannot pass. **Alternatives considered**: a
  separate `logReader.ts` (imports all the same format knowledge for nothing); moving to
  JSON-lines logs (breaks every existing log file and a format operators grep by hand).

- **Detecting scheduler silence**: derive the expected cadence from the log itself — the
  median interval between recorded ticks, flagged when the newest tick is older than three
  times that median, and only once three intervals exist. **Rationale**: the cron interval
  belongs to the host and cron is explicitly out of scope, but the log is a record of that
  interval; the median survives a single long outage in the history.
  **Alternatives considered**: a `doWork.check.maxTickAgeMinutes` config key (needs a
  `config set` subcommand, a wizard screen, validation and docs, must be set per host to be
  correct — and the installation that most needs the diagnostic is the one that never set
  it); a fixed threshold (wrong for both a five-minute and a nightly cadence); the mean
  interval (one past outage masks a current one).

- **A read-only git diagnosis rather than the pre-flight**: new `src/git/repoStatus.ts`
  issuing only ref reads plus one optional `git fetch` of the base branch's
  remote-tracking ref. **Rationale**: `runRepoHygiene`'s dry-run mode describes the
  *mutations it would perform*, not the state of the checkout, and it still fetches and
  prunes; a reader that has no mutating call in it cannot acquire that bug later. This
  reverses the shape sketched in the issue discussion, deliberately.
  **Alternatives considered**: `runRepoHygiene({ dryRun: true })`; reporting the current
  branch's divergence instead of the base branch's (every turn branches from the base, so
  the base's divergence is what stops work).

- **Reaching the real selection path**: `runCheck` calls the same discovery and decision
  functions `runTick` calls and stops before `processItem`, staying inside `doWork.ts` so
  those functions remain private. **Rationale**: the boundary is already clean — everything
  up to `skipDuplicateHeadBranches` is pure reading and the first mutation is inside
  `processItem` — so the check reports the tick's own `Decision[]` rather than a
  simulation. **Alternatives considered**: extracting the discovery block into
  `src/github/workPlan.ts` (moves ~130 lines of working code with no behavioural gain while
  `doWork.ts` stays the only other consumer); shelling out to `do-work --dry-run` (runs the
  mutating pre-flight).

- **Surviving an invalid configuration**: split `resolveSettings` into a
  `resolveSettingsResult(options)` returning `{ ok, settings } | { ok: false, error }`,
  with `resolveSettings` keeping today's `fail()` behaviour and today's messages.
  **Rationale**: the report must name a bad config key rather than die of it, and
  inverting control at one point leaves every existing caller and every existing string
  identical. **Alternatives considered**: a second validator inside the check (two
  validators for one schema, guaranteed to disagree); catching `process.exit` (not
  catchable, and `fail()` has already written to stderr).

- **`--no-fetch` means fully offline**: it suppresses the `git fetch` *and* every `gh`
  call, with the option's help text naming both. **Rationale**: the flag was introduced in
  the issue discussion as the escape hatch for a run that touches no network, and one that
  still made a dozen `gh` calls would not be one. **Alternatives considered**: two flags
  (`--no-fetch` / `--no-github`) for one question; `--no-fetch` skipping git only, which
  leaves no offline mode at all — precisely the situation where connectivity is what is
  being diagnosed.

- **Project structure**: single project, existing directories — the read-side functions go
  beside the write-side ones they mirror (`src/run/runLock.ts`, `src/run/operationLog.ts`),
  git diagnosis under `src/git/`, and only the report model
  (`src/run/checkReport.ts`) is new territory. **Rationale**: reader and writer of a format
  in one place. **Alternatives considered**: a dedicated `src/check/` tree, which would
  separate each reader from the formatter it must track.
