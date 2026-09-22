# Spec Decisions: Blocked-exit diagnostics for `do-work`

**Branch**: `feature/038-blocked-diagnostics`
**Date**: 2026-09-21
**Spec**: [specs/038-blocked-diagnostics/spec.md](../../specs/038-blocked-diagnostics/spec.md)
**Plan**: [specs/038-blocked-diagnostics/plan.md](../../specs/038-blocked-diagnostics/plan.md)
**Research**: [specs/038-blocked-diagnostics/research.md](../../specs/038-blocked-diagnostics/research.md)

## Planning Decisions

- **Splitting `runCheck`**: separate `buildCheckReport(input)` from the printing and the exit code.
  **Rationale**: the blocked dump needs the report but must supply `Selection` from decisions it already has,
  and must not print to stdout or return an exit code. Splitting makes "the dump and `--check` render the same
  thing" a property of the code rather than a convention. **Alternatives considered**: calling `runCheck` from
  the blocked paths — rejected, it prints to stdout, returns an exit code the caller must ignore, and would
  re-run GitHub discovery on every tick of a wedged loop.

- **Heartbeat storage**: a sidecar `.automata/automata-heartbeat.json` bound to the run lock's token, written
  through `LockHandle.heartbeat(state)`. **Rationale**: `runLock.ts`'s protocol rests on `link`/`rename`
  atomicity over one path, and a read-modify-write of the lock mid-tick could recreate a path a contender had
  just renamed away — the three-way race `acquireClaim` exists to close. Token matching also makes a heartbeat
  left by a dead holder read as absent rather than as the current tick's state. **Alternatives considered**:
  extra fields rewritten into the lock file; `/proc/<pid>/cmdline` introspection (platform-specific, says
  nothing about which item is in flight); a file in the operation-log directory (shared between checkouts, and
  that directory is exactly what is under suspicion when this feature is used).

- **The blocked dump does no network work**: `Repository` is inspected with `fetch: false`, and `Selection`
  reuses the decisions the tick already computed or reports "not run: the tick was blocked before discovery".
  **Rationale**: the primary consumer is a cron loop firing every few minutes; a dump that re-ran discovery
  would turn a wedged loop into continuous GitHub API load for output nobody reads. **Alternatives
  considered**: a fully live report identical to `--check`'s; making the dump respect `--no-fetch`, which
  would make it sometimes expensive — the worst of both.

- **Stream discipline**: the dump goes to stderr in text mode and rides inside the existing stdout JSON object
  as `blocked` under `--json`. **Rationale**: `do-work` already splits progress (stderr) from the tick summary
  (stdout), so stderr is the only choice that changes no existing stdout contract. **Alternatives considered**:
  stdout, which would break the `--json` single-object guarantee and every test asserting the summary.

- **Exit codes untouched**: the dump is additive output only. **Rationale**: a diagnostic that changed what
  the loop reported would be a behaviour change disguised as a report. **Alternatives considered**: making a
  blocked tick exit non-zero — rejected, "nothing to do" is exit 0 in this codebase and cron wrappers rely on it.

- **Command trace as a process-wide sink** in `src/run/commandTrace.ts`, with three lines added to each of the
  four `spawnSync` wrappers. **Rationale**: the only way to cover "every git/gh invocation" without threading a
  recorder through dozens of service signatures; it costs one null check per spawn when off. **Alternatives
  considered**: a `--verbose` parameter on each service function; monkey-patching `node:child_process`, which
  is unreviewable and would capture the executor's own children.

- **The trace is an appendix, not a seventh section**: `SECTION_ORDER` stays six long. **Rationale**:
  `specs/036-do-work-check/contracts/check-report.md` and its tests pin the six sections, and the trace raises
  no problems — it is evidence, not a finding. **Alternatives considered**: a seventh `CheckSection`.

- **`Problem.command` may be null**: **Rationale**: several problems have no single investigating command — a
  stopped scheduler is a property of the host's cron. Inventing one would send an operator down a path that
  cannot answer the question. **Alternatives considered**: a required field with a generic fallback command.

- **Live-lock suppression is cross-section judgement, not a time window**: `tickSection` takes the lock status;
  `held`/`suspect` plus an absent-or-empty log states the fact and raises nothing, while an *unreadable* log
  stays a problem. **Rationale**: this is exactly the contradiction issue #82 pasted, and it needs no threshold
  and no new configuration key. **Alternatives considered**: a grace period after the lock's `startedAt`.

- **One `AUTOMATA_OWN_PATHS` list rather than a second path constant** (converge-pass decision, taken during
  implementation): the heartbeat has to be excluded from the working-tree cleanliness check in four places.
  **Rationale**: a file added to the set and missed at one of them makes every item of every tick skip as
  `dirty-tree` in any repository that has not ignored it — that was issue #69 for the run lock alone, and the
  exclusion sites are far enough apart that the next addition would repeat it. The `repoHygiene` and
  `workspaceService` tests now assert the exact list, so a third file added and missed is a failure rather than a
  silent gap. **Alternatives considered**: exporting `HEARTBEAT_RELATIVE_PATH` and naming both at each site.

- **Project structure**: the two new modules go in `src/run/` beside `runLock.ts` and `operationLog.ts` — the
  repository's established home for best-effort side channels (pure format/parse functions plus one I/O entry
  point whose body is a silent `try`/`catch`). **Alternatives considered**: extending `runLock.ts`, which is
  already 554 lines of mutual-exclusion protocol that a diagnostic must not be able to break.
