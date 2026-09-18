# Implementation Plan: `do-work --check` — a read-only health report for the autonomous loop

**Branch**: `feature/036-do-work-check` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/036-do-work-check/spec.md`

## Summary

Add a `--check` flag to `do-work` that produces a six-section health report — run lock,
tick history, work records, git state, live GitHub selection, environment — and exits
`0`/`1` on the absence/presence of problems. Nothing is written: no lock, no GitHub
mutation, no working-copy change, no operation-log entry.

The technical approach keeps the *collection* of every diagnosable fact in new, pure,
independently testable modules, and keeps `doWork.ts` responsible only for wiring the
flag, running the selection path it already owns, and rendering. The two log files and the
lock file gain read-only inspection functions next to the code that writes them, so the
reader and the writer of a format cannot drift apart.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js 22.12+ to run

**Primary Dependencies**: commander.js (flag), `node:child_process` via the existing
`gitService`/`ghWorkService` wrappers, `node:fs` (log and lock reads). No new package.

**Storage**: reads only — `.automata/automata.lock`, `../automata-execution.log`,
`../automata-work.log`, `.automata/config.json`, the git checkout

**Testing**: vitest, `tests/unit/`

**Target Platform**: Linux/macOS developer and CI hosts running the scheduled loop

**Project Type**: single-project CLI

**Performance Goals**: bounded by the same `gh` calls a tick's discovery phase makes —
one candidate list, one surface read per candidate, one link map. No extra GitHub round
trip is introduced.

**Constraints**: strictly read-only apart from `git fetch` of the base branch's
remote-tracking ref; never acquires the run lock; never aborts on a section failure.

**Scale/Scope**: one new flag pair on an existing command, three new source modules, one
new docs section, ~5 new unit-test files.

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I. CLI-First Design | PASS | A flag on the existing `do-work` command, not a new top-level command — the diagnostic is about `do-work` and shares its configuration resolution. `--json` provided. Exit codes meaningful and documented. |
| II. TypeScript Strictness | PASS | No `any`; discriminated unions for every section outcome; all exported functions annotated. |
| III. Test-First | PASS | Collector modules are pure functions over injected inputs (log text, lock contents, git command results), so each acceptance scenario is a unit test. |
| IV. Documentation | PASS | New section in `docs/do-work.md` (the group page for this command); `README.md` untouched — no install, quick-start, command-group or dev-setup change. `CHANGELOG.md` gets an `Unreleased` bullet: a new user-visible flag. |
| V. Single Responsibility | PASS | Collection, judgement and rendering are separated; `doWork.ts` gains wiring and rendering only. |

No violations; the Complexity Tracking table is omitted.

## Project Structure

### Documentation (this feature)

```text
specs/036-do-work-check/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── check-report.md  # The report's text and JSON contract
├── tasks.md             # Phase 2 output
├── pr-report.md
└── spec-decisions.md
```

### Source Code (repository root)

```text
src/
├── commands/
│   └── doWork.ts              # + --check / --no-fetch wiring, runCheck(), renderers
├── run/
│   ├── runLock.ts             # + inspectRunLock(): read-only lock status
│   ├── operationLog.ts        # + readExecutionTicks() / readWorkRecords(): the read side
│   └── checkReport.ts         # NEW: section/problem model, verdict, text + JSON rendering
└── git/
    └── repoStatus.ts          # NEW: read-only git diagnosis (branch, dirty, ahead/behind)

tests/unit/
├── doWorkCheck.cmd.test.ts    # NEW: the command's wiring, refusals, exit codes, JSON
├── checkReport.test.ts        # NEW: verdict, cadence heuristic, rendering
├── operationLog.read.test.ts  # NEW: parsing the two log formats back
├── repoStatus.test.ts         # NEW: git diagnosis over mocked git results
└── runLock.test.ts            # + inspectRunLock cases

docs/do-work.md                # + "Checking the loop's health" section
CHANGELOG.md                   # + Unreleased bullet
```

**Structure Decision**: single project, existing directories. The three concerns already
have homes — the lock and the logs live under `src/run/`, git under `src/git/` — so the
new read-side functions go beside the write-side ones they mirror, and only the report
model (`src/run/checkReport.ts`) is genuinely new territory. `doWork.ts` keeps the
selection path: it already owns `discoverIssues`, `discoverOrphanPrs`, `buildIssueState`
and `describePlan`, and extracting those into a fourth module would be a large refactor of
working code for no gain to this feature.

## Phases

### Phase 0 — Research

Recorded in [research.md](./research.md). Resolves: how to classify a lock without
acquiring it, how to parse both log formats back, how to detect scheduler silence without
a configured interval, which git commands are provably read-only, and how to reach the
selection path without any mutation.

### Phase 1 — Design

- [data-model.md](./data-model.md): the report, its sections, its findings and problems.
- [contracts/check-report.md](./contracts/check-report.md): the text layout and the JSON
  document, field by field.
- [quickstart.md](./quickstart.md): how an operator uses it, and how to verify it changed
  nothing.

### Phase 2 — Tasks

`tasks.md`, generated from the user stories, in dependency order: collectors first (each
with its tests), then the report model, then the command wiring, then documentation.
