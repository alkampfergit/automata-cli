# Tasks: Blocked-exit diagnostics for `do-work`

**Feature**: `feature/038-blocked-diagnostics` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

`[P]` marks tasks that touch disjoint files and can be done in any order relative to each other.

## Phase 1 — The pure model

- [X] **T001** `src/run/commandTrace.ts`: new module. `TracedCommand`, a module-level sink that is null when
  tracing is off, `startCommandTrace()`, `stopCommandTrace()`, `takeCommandTrace()`, `recordCommand(command,
  args, startedAt, exitCode)`. `recordCommand` returns immediately when the sink is null.
- [X] **T002** `tests/unit/commandTrace.test.ts`: records only between start and stop; `take` empties the
  sink; a record made with tracing off is dropped; durations are non-negative.
- [X] **T003** [P] `src/run/heartbeat.ts`: new module. `Heartbeat`, `HeartbeatPhase`, `HeartbeatItem`,
  `HeartbeatExecutor`; pure `formatHeartbeat` / `parseHeartbeat`; `heartbeatPath(cwd)`;
  `writeHeartbeat(state, dir?)` and `clearHeartbeat(dir?)` whose bodies are silent `try`/`catch`;
  `readHeartbeat(token, dir?)` returning null on absent, unparseable or token mismatch.
- [X] **T004** [P] `tests/unit/heartbeat.test.ts`: round-trips the formatter through the parser; a mismatched
  token reads as null; an unparseable file reads as null; a write to an unwritable directory throws nothing;
  `clearHeartbeat` on an absent file throws nothing.
- [X] **T005** [P] `src/run/operationLog.ts`: add `LogDirectoryStatus` and `inspectLogDirectory(dir?)` — the
  resolved directory, the cwd it was derived from, writability via `accessSync(dir, W_OK)`, and the failure
  detail. Never throws.
- [X] **T006** [P] `tests/unit/operationLog.test.ts`: `inspectLogDirectory` reports a writable temp directory
  as writable and a non-existent one as not writable with a detail; the default derives from `dirname(cwd)`.

## Phase 2 — The report model

- [X] **T007** `src/run/checkReport.ts`: `Problem` gains `command: string | null`; `build()` takes
  `[summary, command]` pairs; `renderText` prints `    try: <command>` under a problem that has one;
  `toJson` emits the field. Give every existing problem a command, or null where none investigates it.
- [X] **T008** `src/run/checkReport.ts`: `lockSection` takes a `LockContext` (`cwd`, `logDirectory`) and
  renders the owner's working directory, the heartbeat of a held/suspect lock (phase, item n of m, subject,
  executor and its age), and — when the owner's cwd differs from the checking process's — a problem naming
  both derived log directories.
- [X] **T009** `src/run/checkReport.ts`: `tickSection` takes the `LogDirectoryStatus` and the `LockStatus`;
  always emits the log-directory line (path, derivation, cwd, writability); raises a problem for a
  non-writable directory; suppresses the "no tick recorded" problem — but not its line — when the lock is
  `held` or `suspect`; keeps the unreadable-log problem unconditional.
- [X] **T010** `src/run/checkReport.ts`: `CheckReport` gains `trace: TracedCommand[] | null`;
  `assembleReport` accepts it; `renderText` appends a `Commands (n)` block after the sections and before
  `Problems`; `toJson` emits `trace`.
- [X] **T011** `tests/unit/checkReport.test.ts`: extend for T007–T010 — the `try:` line, the cwd-mismatch
  problem, the heartbeat rendering, the always-present log-directory line, the live-lock suppression (and
  that a free lock still raises it, and that an unreadable log still raises it), the `Commands` block.

## Phase 3 — Lock plumbing

- [X] **T012** `src/run/runLock.ts`: `LockOwner.cwd?`; `publishLock` records `process.cwd()`; `readOwner`
  carries it through; `LockHandle.heartbeat(state)` writes the sidecar bound to the handle's token and
  `release()` clears it; `LockStatus`'s `held`/`suspect` variants carry `heartbeat`.
- [X] **T013** `tests/unit/runLock.test.ts`: a fresh lock records the cwd; a lock written without one parses
  with `cwd` undefined; `inspectRunLock` attaches a matching heartbeat and ignores a mismatched one; the
  release clears the sidecar; a heartbeat write failure does not affect acquisition or release.

## Phase 4 — Trace call sites

- [X] **T014** [P] `src/git/repoStatus.ts`: time `git()` and call `recordCommand`.
- [X] **T015** [P] `src/git/gitService.ts`: same for its `run()`.
- [X] **T016** [P] `src/github/ghWorkService.ts`: same for its `run()`.
- [X] **T017** [P] `src/config/githubService.ts`: same for its `run()`.

## Phase 5 — Command wiring

- [X] **T018** `src/commands/doWork.ts`: add `--verbose`; split `runCheck` into `buildCheckReport(input)` —
  taking the resolved settings, the selection section, whether to fetch, and the trace — plus a thin printer.
  `--check` behaviour is unchanged apart from the new lines.
- [X] **T019** `src/commands/doWork.ts`: `selectionSection` gains the verbose extras — the discovery technique,
  value and limit as sent, the issues discovery returned, and each orphan pull request considered with
  whether the discovery filter kept it.
- [X] **T020** `src/commands/doWork.ts`: `BlockedReason`, `describeBlocked(reason, facts)` and
  `dumpBlocked(...)` — builds the report with `fetch: false` and a supplied selection section, writes text to
  stderr or returns the JSON payload, honours `doWork.dumpOnBlock`, and swallows its own failures.
- [X] **T021** `src/commands/doWork.ts`: wire the five blocked exits — `reportLockHeld` (`lock-held`), the
  settings failure path (`config-invalid`), and `runTick`'s tail (`preflight-failed`, `no-candidates`,
  `all-skipped`) — including the `blocked` key in both JSON payloads.
- [X] **T022** `src/commands/doWork.ts`: heartbeat call sites — `pre-flight` before `runRepoHygiene`,
  `discovery` before the GitHub queries, `item` with the ordinal/total/subject per item, and the executor
  command and start time around `invokeExecutor`.
- [X] **T023** `tests/unit/doWorkCheck.cmd.test.ts`: `--verbose` emits the `Commands` block and the selection
  extras; without it neither appears; the read-only assertions still hold.
- [X] **T024** `tests/unit/doWork.cmd.test.ts`: each of the five blocked exits dumps the report and leaves the
  exit code alone; `dumpOnBlock: false` suppresses it; an answered tick dumps nothing; the dump makes no
  GitHub call; `--json` carries `blocked`; the heartbeat is written for each phase and cleared on release.

## Phase 6 — Configuration

- [X] **T025** `src/config/configStore.ts`: `AutomataDoWorkConfig.dumpOnBlock?: boolean`, `DEFAULT_DO_WORK.dumpOnBlock: true`.
- [X] **T026** `src/commands/doWork.ts`: validate `dumpOnBlock` in `validateDoWorkConfig`; resolve it into `Settings`.
- [X] **T027** `src/commands/config.ts`: `config set do-work-dump-on-block <true|false>`.
- [X] **T028** `src/config/ConfigWizard.tsx`: a screen for it, appended so the existing navigation tests keep working.
- [X] **T029** `tests/unit/config.cmd.test.ts` and `tests/unit/ConfigWizard.test.tsx`: cover both reach points.

## Phase 7 — Documentation and release notes

- [X] **T030** `docs/do-work.md`: the blocked dump and its five triggers, the heartbeat, `--verbose`, the new
  `Run lock` and `Recent ticks` lines, the investigative commands, and `doWork.dumpOnBlock`.
- [X] **T031** `docs/config.md`: the new key.
- [X] **T032** `CHANGELOG.md`: bullets under `## [Unreleased]`.
- [X] **T033** `AGENTS.md`: one line under `## Recent Changes`.

## Phase 9 — Found during implementation

- [X] **T036** `AUTOMATA_OWN_PATHS` in `src/run/runLock.ts`: the heartbeat sidecar has to be excluded from the
  working-tree cleanliness check everywhere the run lock already is — `repoHygiene`'s dirtiness probe and staging
  pathspec, both `workspaceService` branch preparations, and `repoStatus`'s porcelain filter. Without it, a
  repository that has not gitignored the file skips every item as `dirty-tree`, which was issue #69 for the lock
  alone. One shared list rather than a second constant, so a third file cannot be added and missed.
- [X] **T037** `.gitignore` and the wiki setup/troubleshooting pages carry the new path.
- [X] **T038** `Math.max(findIndex(...), 0)` on the wizard's new menu index, matching the executor screen: a stored
  value the option list does not contain must land on the first entry rather than on -1, which every arrow key would
  otherwise carry forward as a selection.

## Phase 8 — Gate

- [X] **T034** `npm test && npm run lint` (read lint through `rtk proxy npm run lint` / `npx eslint src/`).
- [X] **T035** Prove the new tests are not vacuous by mutation: disable the live-lock suppression, the
  cwd comparison, the dump call and the trace recording in turn, and confirm the suite goes red each time.
