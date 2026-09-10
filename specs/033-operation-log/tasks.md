# Tasks: Operation log for `do-work`

**Feature**: `feature/033-operation-log` | **Date**: 2026-09-10

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md)

`[P]` marks tasks that touch disjoint files and may run in parallel.

## Phase 1 — Foundation (blocks everything)

- [X] **T001** Create `src/run/operationLog.ts` with the constants
  (`EXECUTION_LOG_FILE`, `WORK_LOG_FILE`, `MAX_EXECUTION_LINES = 1000`,
  `WORK_RECORD_MAX_AGE_DAYS = 30`, `MAX_DETAIL_LENGTH = 200`) and the types
  `OperationOutcome`, `TickLogItem`, `TickLog` from
  [data-model.md](./data-model.md). No I/O yet.
- [X] **T002** Add `operationLogDirectory(): string` returning
  `dirname(process.cwd())`.

## Phase 2 — Pure formatting and retention (US1, US2)

- [X] **T003** Implement `formatExecutionLine(tick: TickLog): string` per the
  execution-log grammar: ISO timestamp, command, `repo=` (`-` when null),
  `items=`, the five outcome counts always emitted, `runs=`, `exit=`, `dur=`
  with one decimal, optional trailing `note=`. **(FR-002)**
- [X] **T004** Implement `formatWorkRecord(tick: TickLog): string | null`.
  Returns `null` when no item has `ranExecutor`. Otherwise a `=== <iso> <repo>
  ===` header, one line per invoked item, and a trailing blank line. Collapse
  newlines in `detail` and truncate to `MAX_DETAIL_LENGTH` with `…`.
  **(FR-004, FR-005)**
- [X] **T005** Implement `trimToLastLines(content, max)`: unchanged when the
  content holds `max` lines or fewer; otherwise the last `max` lines,
  newline-terminated. A trailing newline must not count as a line. **(FR-003)**
- [X] **T006** Implement `pruneOldRecords(content, now, maxAgeMs)`: keep the
  preamble before the first `=== ` header, then keep each record whose parsed
  header timestamp is newer than the cut-off. Keep records whose header
  timestamp does not parse. **(FR-006)**

## Phase 3 — Filesystem writes (US1, US2, US3)

- [X] **T007** Implement the private `appendWithRetention(dir, file, content,
  retain)` helper: `appendFileSync`, then read back, apply `retain`, and — only
  if it changed the content — write `<file>.<pid>.tmp` and `renameSync` over
  the target. **(FR-003, FR-006)**
- [X] **T008** Implement `recordTick(tick: TickLog, dir = operationLogDirectory())`:
  `accessSync(dir, W_OK)` pre-check, then the execution append, then the work
  append when `formatWorkRecord` returns non-null. Wrap the whole body in one
  `try`/`catch` that discards the error and writes nothing. **(FR-001, FR-007,
  FR-008)**

## Phase 4 — Tests for the module [P after Phase 3]

- [X] **T009 [P]** Create `tests/unit/operationLog.test.ts` covering
  `formatExecutionLine`: all five outcome buckets present at zero, `repo=-`
  when null, the `note=` suffix, one-decimal duration, and that the result is
  exactly one line. **(SC-005)**
- [X] **T010 [P]** Cover `formatWorkRecord`: `null` when nothing ran, only
  `ranExecutor` items listed, executor/model/effort rendered, detail newline
  collapsing and truncation at 200 characters.
- [X] **T011 [P]** Cover `trimToLastLines`: below, at and above the limit;
  1000-line boundary; content with and without a trailing newline. **(SC-002)**
- [X] **T012 [P]** Cover `pruneOldRecords`: a 40-day-old record dropped and a
  5-day-old one kept; preamble preserved; an unparseable header kept; empty
  content returns empty. **(SC-003)**
- [X] **T013** Cover `recordTick` against a temporary directory: creates both
  files, appends across calls, writes no work log when nothing ran, keeps the
  execution log at 1000 lines after crossing the boundary, and prunes old work
  records. **(SC-001, SC-002, SC-003)**
- [X] **T014** Cover the failure paths: a non-existent directory and a
  directory with write permission removed both return without throwing and
  create nothing. **(FR-007, FR-008, SC-004)**

## Phase 5 — Wire into `do-work` (US1, US2)

- [X] **T015** Change `runTick` in `src/commands/doWork.ts` to return
  `{ exitCode: number; reports: ItemReport[] }`; update the `--dry-run` branch
  and both call sites in the action. **(FR-009)**
- [X] **T016** Add `toTickLogItem(report: ItemReport): TickLogItem` next to
  `toItemJson`, flattening `execution` into `executor` / `model` / `effort`.
- [X] **T017** Record `Date.now()` before the tick and call `recordTick` after
  the lock-releasing `finally`, including on the thrown-tick path. Resolve the
  repo slug inside a `try` so a `gh` failure yields `repo: null`. **(FR-001)**
- [X] **T018** Log a `note=lock-held` line from the lock-held path with zero
  items. **(FR-001)**

## Phase 6 — Tests for the wiring

- [X] **T019** In `tests/unit/doWork.cmd.test.ts`, mock
  `../../src/run/operationLog.js` and assert: a normal tick calls `recordTick`
  once with the right item outcomes and exit code; `--dry-run` does not call it;
  a lock-held run calls it with `note: "lock-held"`. **(FR-009, FR-010)**
- [X] **T020** Assert the existing `--json` payload is byte-identical to before
  the change (no new key). **(FR-010)**

## Phase 7 — Documentation

- [X] **T021** Add an "Operation log" section to `docs/do-work.md`: both file
  names and locations, the two grammars with an example each, the retention
  rules, the permission behaviour, and the known limits from
  [quickstart.md](./quickstart.md).
- [X] **T022** Confirm `README.md` needs no change (no new command, flag,
  install step or dev-setup change) per the documentation convention in
  `AGENTS.md`.

## Phase 8 — Gate

- [X] **T023** Run `npm test && npm run lint` (reading the real lint gate with
  `npx eslint src/` per the repo's RTK note) and fix any failure.
- [X] **T024** Typecheck the new test file explicitly — `tsconfig.json` covers
  only `src/`, so vitest passing does not prove the fixtures typecheck.
- [X] **T025** Manual smoke: build, run `do-work --dry-run` from a temporary
  checkout and confirm neither file appears; then exercise `recordTick`
  directly against a temporary directory and confirm both files and their
  retention.

## Dependencies

```text
T001 → T002 → T003..T006 → T007 → T008 → T009..T014
T008 → T015 → T016 → T017 → T018 → T019, T020
T019 → T021 → T022 → T023 → T024 → T025
```
