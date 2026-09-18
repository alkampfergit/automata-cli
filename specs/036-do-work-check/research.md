# Phase 0 Research: `do-work --check`

## R1 — Classifying the run lock without acquiring it

**Decision**: add `inspectRunLock(staleMinutes): LockStatus` to `src/run/runLock.ts`,
reusing the module's existing private `readOwner`, `isStale` and `heldTooLong`.

**Rationale**: those three functions already encode the exact judgement `acquireRunLock`
makes — same-host liveness beats age, a verified `pidStartedAt` retires the pid-reuse
case, an unverifiable live lock past the staleness window is *suspect*. Re-deriving that
in a new module would give `--check` a second opinion about the same file, and the two
would drift the first time the lock format changes. `acquireRunLock` itself cannot be
reused: it creates the lock when the path is free, which FR-002 forbids.

**Alternatives considered**:
- *Call `acquireRunLock` and release immediately.* Rejected: it writes the lock file into a
  repository that may not ignore it, and for the sub-millisecond it is held it turns away a
  real tick — a diagnostic that can break the thing it is diagnosing.
- *`pgrep`-style process scan, as in the script in issue #75.* Rejected: it cannot name an
  orphaned lock, which is the failure mode 034 was written for, and it is not portable.

## R2 — Reading the two operation logs back

**Decision**: add `readExecutionTicks()` and `readWorkRecords()` to
`src/run/operationLog.ts`, parsing the formats `formatExecutionLine` and
`formatWorkRecord` produce. Both take the log text (and the directory, defaulted to
`operationLogDirectory()`), both filter by repository slug, both skip and count malformed
entries rather than throwing.

**Rationale**: reader and writer in one module means one place to look when the format
changes, and the round-trip is directly unit-testable — the tests write a line with the
existing formatter and parse it back with the new one, so a field rename cannot pass. The
formats were designed for this: the execution log is `key=value` after a leading ISO
timestamp and command, and work records are delimited by a `=== <iso> <slug> ===` header
that `pruneOldRecords` already scans for.

**Alternatives considered**:
- *A separate `logReader.ts`.* Rejected: it would import the constants and the format
  knowledge of `operationLog.ts` anyway, with nothing gained but an extra file.
- *Structured (JSON-lines) logs.* Rejected: it would change a format operators already
  grep by hand, and break every existing log file — far outside this feature.

## R3 — Detecting scheduler silence without a configured interval

**Decision**: compute the intervals between consecutive recorded ticks for this
repository, take the median, and report "the scheduler appears to have stopped" when the
newest tick is older than `3 ×` that median. Require at least three intervals (four ticks)
before judging; below that, report the age without a verdict.

**Rationale**: the cron interval belongs to the host, not to automata — the issue
explicitly rules cron out of scope — but the log *is* a record of that interval. The
median is robust against the one long gap a machine reboot or a holiday leaves. `3 ×`
tolerates a tick that overran its slot and one that was skipped, while still catching a
scheduler that has genuinely stopped. Requiring three intervals stops a fresh install from
reporting a failure on its second day.

**Alternatives considered**:
- *A `doWork.check.maxTickAgeMinutes` config key.* Rejected: a new key needs a `config set`
  subcommand, a wizard screen, validation and docs (the established four-point pattern), it
  must be set per host to be correct, and an unset one is the common case — which is
  exactly the installation that needs the diagnostic most.
- *A fixed threshold (e.g. two hours).* Rejected: wrong for both a five-minute cadence and
  a nightly one.
- *The mean interval.* Rejected: one multi-day outage in the history moves the mean far
  enough to mask a current outage.

## R4 — A provably read-only git diagnosis

**Decision**: a new `src/git/repoStatus.ts` with one exported
`inspectRepoStatus({ baseBranch, fetch })`, issuing only:
`git rev-parse --abbrev-ref HEAD`, `git symbolic-ref --quiet --short HEAD`,
`git status --porcelain`, `git rev-parse --verify --quiet <ref>`,
`git rev-parse --abbrev-ref --symbolic-full-name <branch>@{u}`,
`git rev-list --left-right --count <upstream>...<branch>`, and — unless suppressed —
`git fetch origin +refs/heads/<base>:refs/remotes/origin/<base>`.

**Rationale**: every one of those either reads refs or writes only a remote-tracking ref,
so the module cannot modify the working copy or a local branch even by mistake. Keeping
them in one small module makes that property reviewable at a glance, which a diffuse set
of calls inside `doWork.ts` would not be. The fetch refspec is the one `gitService.fetchBranch`
already uses, so the check and the tick agree about what "refreshed" means.

**Alternatives considered**:
- *Reuse `runRepoHygiene` with `dryRun: true`.* Rejected — and this reverses the shape
  sketched in the issue discussion. Its dry-run mode describes the *mutations it would
  perform* (which branch it would rescue onto, which it would delete), not the state of the
  checkout; it still runs `git fetch --prune` and branch lookups for the prune phase; and
  one future non-dry-run-guarded write inside it would silently make `--check` mutating. A
  read-only reader cannot acquire that bug.
- *Report the current branch's divergence.* Rejected: every turn branches from the base
  branch and the pre-flight fast-forwards the base branch, so the base branch's divergence
  is what stops work. The current branch is reported for context only.

## R5 — Reaching the real selection path without any mutation

**Decision**: `runCheck` calls the discovery and decision functions `runTick` already
calls — `discoverIssues`, `getOpenPrLinkMap`, `buildIssueState`, `decideWork`,
`discoverOrphanPrs`, `getPrSurface`, `decideOrphanPrWork`, `skipDuplicateHeadBranches` —
and stops there, before `processItem`. It lives in `doWork.ts` so those functions stay
private.

**Rationale**: the boundary is already clean. In `runTick`, everything up to and including
`skipDuplicateHeadBranches` is pure reading (`gh issue list`, `gh issue view`, a GraphQL
link-map query) and the first mutation is inside `processItem` — `claimIssue`,
`postMarker`, branch preparation. Cutting at that line means `--check` reports the same
`Decision[]` a tick would compute, with the same skip reasons, rather than a simulation
that can disagree.

**Alternatives considered**:
- *Extract the discovery block into `src/github/workPlan.ts` and import it from a separate
  check module.* Rejected for this feature: it moves ~130 lines of working code and the
  `Settings`-shaped parameter with it, for no behavioural gain — the risk is all downside
  while `doWork.ts` remains the only consumer besides the check.
- *Call `do-work --dry-run` as a subprocess.* Rejected: it runs the mutating pre-flight.

## R6 — Surviving an invalid configuration

**Decision**: split `resolveSettings` into a pure `resolveSettingsResult(options)`
returning `{ ok: true, settings } | { ok: false, error }`, with `resolveSettings` keeping
its current behaviour by calling `fail()` on the error. `--check` uses the result form and
reports the error as a finding.

**Rationale**: FR-014 requires the report to survive a bad configuration, and today every
configuration fault leaves `do-work` through `process.exit`. Inverting the control at one
point keeps every existing caller and every existing message identical — the error strings
are unchanged, only their delivery differs — and it is the smallest change that makes the
environment section possible.

**Alternatives considered**:
- *Re-validate the configuration inside the check.* Rejected: two validators for one
  schema, guaranteed to disagree.
- *Catch `process.exit` in the check.* Rejected: not catchable, and the surrounding
  `fail()` writes to stderr on the way out.

**Caveat**: `resolveSettings` also calls `checkAuthenticatedIdentity`, which exits on a
misconfigured login. The check must not take that path; it runs its own identity probe and
reports the same condition as a finding, exactly as `--dry-run` already skips the guard.

## R7 — `--no-fetch` means fully offline

**Decision**: `--no-fetch` suppresses the git fetch *and* every `gh` call. The git section
labels its ahead/behind figures as not refreshed; the selection section reports that it
did not run and contributes no problem.

**Rationale**: the flag was introduced in the issue discussion as the escape hatch for a
run that touches no network, and a `--no-fetch` run that still made a dozen `gh` calls
would not be one. The option's help text names both effects so the name cannot mislead.

**Alternatives considered**:
- *Two flags (`--no-fetch`, `--no-github`).* Rejected: two flags for one question
  ("may I use the network?"), and neither was asked for.
- *`--no-fetch` skips git only.* Rejected: leaves no way to run the diagnostic offline,
  which is precisely the situation where the loop has stopped and the operator is
  debugging connectivity.

## Autonomous Decisions

Every decision above was taken without user input; the alternatives are recorded so a
reviewer can overturn any of them deliberately. Additionally:

- **Exit code `1` for "problems found"** rather than `2` ("degraded") — `1` was the
  convention of the script supplied in the issue and was committed to in the issue
  discussion. `2` in `do-work` means "the tick ran and was degraded", which a read-only
  report never does.
- **`--check` with `--dry-run` is refused** rather than one silently winning: they are two
  different read-only reports, and a silent preference would make one of the two flags a
  lie.
- **History window**: 20 execution-log ticks, 3 work-log records. Enough to show a cadence
  and the last real activity; beyond that the report stops being readable in a terminal.
