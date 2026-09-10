# Implementation Plan: Operation log for `do-work`

**Branch**: `feature/033-operation-log` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/033-operation-log/spec.md`

## Summary

`do-work` gains a diagnostic side channel: one line per invocation in
`../automata-execution.log` (capped at the newest 1000 lines) and one record per
invocation that actually ran the executor in `../automata-work.log` (records
older than 30 days pruned). All file work lives in a new
`src/run/operationLog.ts` alongside the existing `runLock.ts`; `doWork.ts` gains
one call site and one small mapping function. Every failure path — unwritable
directory, missing parent, EACCES on an existing file, a corrupt work log — is
swallowed so the tick's stdout and exit code are untouched.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js 22.12+ runtime

**Primary Dependencies**: none added. `node:fs` (`appendFileSync`, `readFileSync`,
`writeFileSync`, `renameSync`, `accessSync`), `node:path` (`dirname`, `join`) —
the same built-ins `src/run/runLock.ts` already uses.

**Storage**: two plain-text files in `path.dirname(process.cwd())`, outside the
repository.

**Testing**: vitest. Pure formatting/trimming/pruning functions unit-tested
directly; file I/O tested against a `mktemp`-style directory under the repo;
the `do-work` wiring tested in `tests/unit/doWork.cmd.test.ts` with
`src/run/operationLog.js` mocked.

**Target Platform**: Linux/macOS developer and cron hosts.

**Project Type**: single-project CLI.

**Performance Goals**: negligible. One append per tick; a full read+rewrite only
on the tick that crosses the 1000-line boundary (≈150 KB) and on every work-log
append (bounded by 30 days of executor runs).

**Constraints**: MUST NOT alter `do-work` stdout, its `--json` payload or its
exit code (FR-008, FR-010). MUST NOT throw.

**Scale/Scope**: one new module (~180 lines), one new test file, ~30 lines of
wiring in `doWork.ts`, one docs section.

## Constitution Check

| Principle | Assessment |
|-----------|------------|
| I. CLI-First Design | No new command or flag. Existing exit codes and the `--json` payload are explicitly unchanged (FR-010). **Pass.** |
| II. TypeScript Strictness | New module is fully annotated; no `any`. The `Record<OperationOutcome, number>` built in `doWork.ts` makes a future outcome value a compile error rather than a silently missing bucket. **Pass.** |
| III. Single Responsibility | Logging lives in its own module rather than being inlined into the 1468-line `doWork.ts`; `doWork.ts` keeps only the mapping from `ItemReport` to the log's input type. Only `do-work` is touched (FR-011). **Pass.** |
| IV. npm Distribution | No dependency added; nothing new to bundle. **Pass.** |
| V. Simplicity | No config key, no opt-out, no log rotation framework, no JSON format — the two files and their two retention rules, and nothing else. Retention is done inline with `fs` rather than by adding a rotation library. **Pass.** |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/033-operation-log/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── pr-report.md
├── spec-decisions.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── run/
│   ├── runLock.ts               # existing — the sibling this module matches
│   └── operationLog.ts          # NEW: location, formatting, retention, writes
└── commands/
    └── doWork.ts                # MODIFIED: runTick returns reports; one recordTick call

tests/
└── unit/
    ├── operationLog.test.ts     # NEW: formatting, trimming, pruning, I/O, permissions
    └── doWork.cmd.test.ts       # MODIFIED: mocks operationLog, asserts wiring

docs/
└── do-work.md                   # MODIFIED: new "Operation log" section
```

**Structure Decision**: Single project, flat modules, matching the existing
layout. `src/run/` already holds the per-run runtime concerns (`runLock.ts`), so
the operation log belongs there rather than in a new top-level directory —
consistent with Principle V's preference for a flat structure.

## Phase 1 Design

### Module boundary

`src/run/operationLog.ts` exports:

- Constants: `EXECUTION_LOG_FILE`, `WORK_LOG_FILE`, `MAX_EXECUTION_LINES`,
  `WORK_RECORD_MAX_AGE_DAYS`, `MAX_DETAIL_LENGTH`.
- Types: `OperationOutcome`, `TickLogItem`, `TickLog`.
- Pure functions (directly unit-testable, no I/O): `formatExecutionLine`,
  `formatWorkRecord`, `trimToLastLines`, `pruneOldRecords`.
- I/O: `operationLogDirectory()`, `recordTick(tick, dir?)`.

`recordTick` is the single entry point and the only function that can touch the
filesystem. Its `dir` parameter defaults to `operationLogDirectory()` and exists
so tests can point it at a temporary directory without stubbing `process.cwd`.

### `doWork.ts` changes

1. `runTick` returns `{ exitCode: number; reports: ItemReport[] }` instead of a
   bare `number`. The `--dry-run` branch returns `{ exitCode: 0, reports: [] }`
   and the action's dry-run path returns before any logging, satisfying FR-009.
2. The action records `Date.now()` before the tick and calls `recordTick` after
   the `finally` that releases the lock — so a thrown tick is still logged, with
   `exit=1` and no items.
3. `reportLockHeld` returns its exit code as today; the action logs a
   `note=lock-held` line for it.
4. `toTickLogItem(report)` maps `ItemReport` → `TickLogItem`, flattening
   `execution` into `executor` / `model` / `effort`, exactly as `toItemJson`
   already does for `--json`.

### Failure containment

`recordTick`'s whole body is inside one `try`/`catch`. The catch writes nothing
— not even to stderr — because a cron tick that logs a warning on every run in
a read-only workspace is noise, and FR-007 calls this case "just ignore". A
`fs.accessSync(dir, W_OK)` pre-check short-circuits the common unwritable case
before any file is opened.

## Complexity Tracking

Not applicable — no Constitution Check violations.
