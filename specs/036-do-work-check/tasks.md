# Tasks: `do-work --check` — a read-only health report for the autonomous loop

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/check-report.md](./contracts/check-report.md)

**Conventions**: `[P]` = can run in parallel with the other `[P]` tasks in the same phase
(different files, no ordering dependency). Every path is repository-relative.

---

## Phase A — Collectors (no command wiring yet)

- [ ] **T001** [P] `src/run/runLock.ts`: add the `LockStatus` union and
  `inspectRunLock(staleMinutes: number): LockStatus`, reusing the existing private
  `readOwner` / `isStale` / `heldTooLong`. Must never create, rename or unlink anything.
  (R1, FR-002, FR-005)
- [ ] **T002** [P] `tests/unit/runLock.test.ts`: cases for `free`, `held` (live, in
  window), `suspect`, `stale` (dead pid) and `unreadable`; plus an assertion that calling
  `inspectRunLock` in a directory with no lock leaves no lock file behind.
  (Story 1 scenarios 1–4)
- [ ] **T003** [P] `src/run/operationLog.ts`: add `ExecutionTick`, `WorkRecord`,
  `WorkRecordItem`, `readExecutionTicks()` and `readWorkRecords()` — newest first, slug
  filtered, malformed entries skipped and counted, a missing file reported rather than
  thrown. (R2, FR-006, FR-007, FR-009)
- [ ] **T004** [P] `tests/unit/operationLog.read.test.ts`: round-trip tests —
  `formatExecutionLine` → `readExecutionTicks`, `formatWorkRecord` → `readWorkRecords` —
  plus slug filtering, malformed-line counting, a missing file, and a record written by an
  older automata (missing `note`, missing executor brackets).
- [ ] **T005** [P] `src/git/repoStatus.ts`: `RepoStatus` and
  `inspectRepoStatus({ baseBranch, fetch })`, issuing only the read-only commands listed
  in R4, excluding the run lock's own path from the dirty list, and reporting a fetch
  failure rather than throwing. (R4, FR-004, FR-010, FR-011)
- [ ] **T006** [P] `tests/unit/repoStatus.test.ts`: clean/level, dirty with paths,
  detached HEAD, base branch absent locally, no upstream, ahead/behind counts, `fetch:
  false` (no fetch issued, `refreshed: false`), fetch failure. Assert the exact argv of
  every git call so a mutating command cannot be added unnoticed.

## Phase B — Report model

- [ ] **T007** `src/run/checkReport.ts`: the `CheckReport` / `CheckSection` / `Problem`
  model, `tickCadence()` (median interval, `3 ×` silence rule, three-interval minimum),
  the section builders for `lock`, `ticks`, `work` and `git`, `renderText()` and
  `toJson()`. Depends on T001, T003, T005 for its input types. (R3, FR-008, FR-015, FR-016)
- [ ] **T008** `tests/unit/checkReport.test.ts`: the cadence heuristic (median, the
  three-interval floor, the `3 ×` boundary either side), problem attribution per section,
  the verdict line for both exit codes, `renderText` section order and the fixed headings,
  `toJson` shape against the contract.

## Phase C — Command wiring

- [ ] **T009** `src/commands/doWork.ts`: split `resolveSettings` into
  `resolveSettingsResult(options)` returning a discriminated union, with `resolveSettings`
  keeping today's `fail()` behaviour and today's messages. (R6)
- [ ] **T010** `src/commands/doWork.ts`: add the `--check` and `--no-fetch` options with
  help text that names `--no-fetch`'s full effect (no `git fetch`, no `gh`); refuse
  `--check --dry-run`; route `--check` to `runCheck` before the run lock is acquired and
  before `logTick` can run. (FR-001, FR-002, FR-018, FR-020)
- [ ] **T011** `src/commands/doWork.ts`: `runCheck(options)` — assemble the four local
  sections from Phase A/B, build the `environment` section (version, slug, config
  validity, `gh` availability and login, identity misconfiguration, discovery filter, base
  branch, run cap, executor and its command on `PATH`), and the `selection` section by
  running the real discovery/decision path and stopping before `processItem`. Render text
  or JSON; exit `0`/`1`. (FR-003, FR-012, FR-013, FR-014, FR-017, R5, R7)
- [ ] **T012** `tests/unit/doWorkCheck.cmd.test.ts`: the command-level tests —
  `--check --dry-run` refused; `acquireRunLock` and `recordTick` never called; no GitHub
  write and no executor invoked; a `gh` failure confined to its section while the rest
  still prints; an invalid configuration reported as a finding with the other sections
  still printed; `--no-fetch` suppressing both the fetch and every `gh` call; `--issue`
  narrowing the selection; exit `0` vs `1`; `--json` emitting one parseable document.
  (Story 3 scenarios 2–4, Story 5 scenarios 2–5)

## Phase D — Documentation & release notes

- [ ] **T013** [P] `docs/do-work.md`: a "Checking the loop's health" section — what each
  report section answers, the flags, the exit codes, what counts as a problem (including
  the cadence heuristic and why a live lock does not), the `--json` shape, and the list of
  things the check never does. Cross-link from the options table, the run-lock section and
  the operation-log section.
- [ ] **T014** [P] `CHANGELOG.md`: one bullet under `## [Unreleased]` — `do-work` gained
  `--check` and `--no-fetch`.
- [ ] **T015** [P] `AGENTS.md`: add the feature to `## Recent Changes`.

## Phase E — Gate

- [ ] **T016** `npm test && npm run lint` green; `npx prettier --check` on every new file.
- [ ] **T017** Smoke-run `node dist/index.js do-work --check` and
  `--check --no-fetch --json` in this checkout, and verify against the quickstart that the
  working tree, the operation logs and the lock file are unchanged.

---

## Dependency order

```
T001,T003,T005  ──►  T007  ──►  T009 ──► T010 ──► T011 ──► T012 ──► T016 ──► T017
   │   │   │            │
   ▼   ▼   ▼            ▼
 T002 T004 T006        T008                    T013,T014,T015 (any time after T011)
```

## Story coverage

| Story | Tasks |
|---|---|
| 1 — running now / last tick | T001–T004, T007, T008, T011 |
| 2 — what the last runs did | T003, T004, T007, T011 |
| 3 — why nothing is picked up | T011, T012 |
| 4 — checkout state | T005–T008, T011 |
| 5 — environment | T009, T011, T012 |
