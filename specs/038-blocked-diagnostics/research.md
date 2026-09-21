# Phase 0 Research: Blocked-exit diagnostics for `do-work`

## What already exists

| Concern | Where | Reusable as-is? |
|---|---|---|
| The six-section report model and renderer | `src/run/checkReport.ts` | Yes — `assembleReport` / `renderText` / `toJson` are pure over `CheckSection[]`. |
| The collectors for the six sections | `runCheck` in `src/commands/doWork.ts:1950` | Only after it is split: it currently collects *and* prints *and* returns the exit code. |
| Lock inspection | `inspectRunLock` in `src/run/runLock.ts` | Yes; `LockOwner` gains one field. |
| Log readers | `readExecutionTicks` / `readWorkRecords` in `src/run/operationLog.ts` | Yes; a directory probe is added beside them. |
| Read-only checkout inspection | `inspectRepoStatus` in `src/git/repoStatus.ts` | Yes. |
| The five blocked exits | `reportLockHeld`, `fail`/`resolveSettings`, `runTick`'s tail | Each needs one call added. |

## Decisions

### Decision: split `runCheck` into `buildCheckReport(input)` and a thin printer

**Rationale**: the blocked dump needs the *report*, not the printing or the exit code, and needs to supply
`Selection` from decisions it already has rather than from a live query. Splitting gives one collector with
explicit inputs (`selection: CheckSection`, `fetch: boolean`) and makes "the dump and `--check` render the
same thing" a property of the code rather than of a convention.

**Alternatives considered**: calling `runCheck` from the blocked paths — rejected, it prints to stdout, it
returns an exit code the blocked path must ignore, and it would re-run GitHub discovery on every tick of a
wedged loop.

### Decision: the heartbeat is a sidecar file bound to the lock token

`.automata/automata-heartbeat.json`, holding `{ token, updatedAt, phase, item?, executor? }`. Written by
`LockHandle.heartbeat(state)` — which is where the token already lives — and read by `inspectRunLock`, which
discards a heartbeat whose token does not match the lock it just read.

**Rationale**: `runLock.ts`'s whole protocol rests on `link`/`rename` atomicity over one path. A read-modify-
write of the lock file mid-tick could recreate a path a contender had just renamed away as stale, which is
the exact three-way race `acquireClaim` exists to close. A sidecar cannot participate in that protocol at
all. Token matching means a heartbeat left by a dead holder reads as absent rather than as the current tick's
state — the failure mode that would make the feature actively misleading.

**Alternatives considered**: extra fields on `LockOwner` rewritten in place (rejected as above);
`/proc/<pid>/cmdline` introspection (rejected — platform-specific and says nothing about which item is in
flight); a second log file in the operation-log directory (rejected — that directory is shared between
checkouts and is exactly the thing under suspicion when this feature is being used).

### Decision: the blocked dump never fetches and never re-queries GitHub

`Repository` is inspected with `fetch: false`; `Selection` is handed the decisions the tick already computed,
or rendered as "not run: the tick was blocked before discovery" for the two reasons that fire before
discovery (`lock-held`, `config-invalid`).

**Rationale**: the primary consumer is a cron loop firing every few minutes. A dump that re-ran discovery
would turn a wedged loop into a continuous GitHub API load for output nobody reads, and `git fetch` from a
tick that is exiting cannot improve an answer the tick did not act on.

**Alternatives considered**: a full live report identical to `--check`'s (rejected for the cost above);
making the dump respect `--no-fetch` (rejected — it would mean the dump is sometimes expensive, which is the
worst of both).

### Decision: the dump goes to stderr in text mode

**Rationale**: `do-work` already splits its streams — `progress()` to stderr, the tick summary to stdout —
and every existing test asserts against one of the two. Writing the dump to stderr means no existing stdout
contract changes, and `--json` stdout stays exactly one parseable object (the dump rides inside it as
`blocked`).

### Decision: the `--verbose` command trace is a process-wide sink in `src/run/commandTrace.ts`

A module-level array, `null` when tracing is off. The four `spawnSync` wrappers (`src/git/repoStatus.ts`,
`src/git/gitService.ts`, `src/github/ghWorkService.ts`, `src/config/githubService.ts`) each gain three lines
that record command, args, duration and exit code.

**Rationale**: it is the only way to cover "every git/gh invocation" without threading a recorder through
every service signature, and when tracing is off it costs one null check per spawn. The alternative — a
`--verbose` parameter on each service function — would touch dozens of signatures for a diagnostic.

**Alternatives considered**: wrapping `spawnSync` itself by monkey-patching `node:child_process` (rejected:
unreviewable, and it would catch the executor's own child processes too).

### Decision: the trace is an appendix, not a seventh `CheckSection`

**Rationale**: `SECTION_ORDER` is six long and `specs/036-do-work-check/contracts/check-report.md` plus its
tests pin that. A seventh section would also have to answer "what problems does it raise?", and the answer is
none — it is evidence, not a finding.

### Decision: `Problem.command` is optional and may be null

**Rationale**: several problems have no single investigating command (a stopped scheduler is a property of
the host's cron, not of anything automata can run). Inventing one would send an operator down a path that
cannot answer the question, which is worse than printing nothing.

### Decision: the "no tick recorded" finding is suppressed by a live lock, not by a time window

`tickSection` takes the lock status. `held` or `suspect` plus an absent-or-empty log means a first tick is in
flight and has not recorded itself; that is stated as a line and raises nothing. An unreadable log stays a
problem regardless, because a live tick does not explain a permissions failure.

**Rationale**: this is the exact contradiction issue #82 pasted, and cross-section judgement is what resolves
it — no threshold, no new configuration key.

## Verified against the codebase

- `operationLogDirectory()` is `dirname(process.cwd())` (`src/run/operationLog.ts:104`); the path is already
  carried on `LogReadResult.path`, so the section has the value and simply never printed its provenance.
- `LockOwner` is parsed field-by-field in `readOwner`, so an added optional `cwd` is absent-tolerant with no
  version marker.
- `recordTick` is called from `logTick` *after* the lock is released, which is why a first-ever tick in
  flight has no line — confirming the second cause named in the issue.
- `inspectRepoStatus` already reports `refreshed: false` and the renderer already prints `(not refreshed)`,
  so the no-fetch dump needs no new wording.
- `runTick` returns `{ exitCode, reports }`; the decisions it computed are local to it, so the blocked
  classification has to happen inside `runTick` where both are in scope.
- `--verbose` is not taken by any existing option on `do-work` (`--with --model --effort --issue --pr --limit
  --max-runs --dry-run --check --no-fetch --json --silent`).
- `DEFAULT_DO_WORK` has no boolean key yet; `configSetDoWorkExecutor` is the nearest shape for a constrained
  string, and `parseNonNegativeInt` the nearest for a parsed value — a boolean needs its own small parser.

## Risks

- **Test blast radius**: `doWork.cmd.test.ts` mocks `runLock.js` and `operationLog.js`. Per repository memory
  every mock factory must spread `importOriginal`, or a new export breaks the suite at import time. The new
  `commandTrace.js` and `heartbeat.js` modules must be added to the mocks that need them.
- **`--json` exact-object assertions**: adding `blocked` to the tick JSON and `command` to `Problem` will break
  `toEqual` assertions. Expect one failure per exact-object assertion and update them.
- **`prettier`/`lint` baseline**: `develop` already fails `prettier --check` on `src/`; only `npm test && npm
  run lint` is the gate, and `npm run lint` must be read through `rtk proxy` or `npx eslint src/`.
