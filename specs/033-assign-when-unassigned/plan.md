# Implementation Plan: Claim an unassigned issue and pull request for the agent

**Branch**: `feature/033-assign-when-unassigned` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/033-assign-when-unassigned/spec.md`

## Summary

Change the loop's claim rule from "add the agent unless it is already an assignee" to
"assign the agent only when nobody is assigned", and apply the same rule to the pull
request. The decision stays in the pure state machine (`decideWork`) as two booleans
on `WorkItem`; the two `gh` calls that act on them are advisory wrappers next to the
existing `assignIssueToAgent`. `implement-next` gets the pull-request half of the rule
on its post-run reconciliation path.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js 22.13+/24 LTS to develop

**Primary Dependencies**: commander.js (CLI), `gh` CLI via `spawnSync` (all GitHub I/O)

**Storage**: N/A — assignee state lives on GitHub; nothing is persisted locally

**Testing**: vitest (unit + command-level with `vi.mock`ed services)

**Target Platform**: Linux/macOS CLI, bundled with tsup

**Project Type**: single-project CLI

**Performance Goals**: at most one extra `gh` call per claimed surface per item; zero
extra calls when the surface is already assigned or already unassignable

**Constraints**: every claim advisory (a repository where the agent has no write
access must keep working); `--dry-run` must perform no writes; the turn decision must
stay free of I/O so it remains exhaustively unit-testable without a `gh` binary

**Scale/Scope**: 5 source files, 4 test files, 1 docs page; no new dependency

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I. CLI-First Design | PASS | No new command or flag. Existing `--dry-run` and `--json` surfaces are extended, not replaced; exit codes unchanged (FR-006). |
| II. TypeScript Strictness | PASS | Two new `boolean` fields with explicit types, one new `string[]` field on an exported interface, no `any`. |
| III. Single Responsibility Commands | PASS | Decision logic stays in `src/github/workDetection.ts`, `gh` I/O in `src/github/ghWorkService.ts`, advisory reporting in the commands. No duplicated `spawnSync` runner. |
| IV. npm Distribution | PASS | No dependency change, no build change. |
| V. Test-First / coverage | PASS | Each behavioural change lands with a unit test; the two existing `needsAssignment` tests are rewritten to the new rule rather than deleted. |
| GitFlow | PASS | `feature/033-assign-when-unassigned` off `develop`. |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/033-assign-when-unassigned/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 decisions
├── data-model.md        # The two decision booleans and the surface fields they read
├── quickstart.md        # How to exercise the change by hand
├── pr-report.md         # Reviewer-facing summary
├── spec-decisions.md    # Planning decisions appendix
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── github/
│   ├── ghWorkService.ts     # + assignees on PrSurface; + assignPrToAgent(); doc on assignIssueToAgent
│   └── workDetection.ts     # needsAssignment rule flipped; + prNeedsAssignment; isAssignedToAgent removed
├── config/
│   └── githubService.ts     # getCurrentBranchPr() also returns assignees
└── commands/
    ├── doWork.ts            # claimPr(); claim on build turns; claim in repairIssueLink; plan/JSON reporting
    └── getReady.ts          # claim the pull request in linkPrToIssue()

tests/unit/
├── workDetection.test.ts    # rewritten claim rule + prNeedsAssignment cases
├── ghWorkService.test.ts    # assignees parsing + assignPrToAgent
├── doWork.cmd.test.ts       # dry-run plan text, claim calls per turn, advisory failure
└── getReady.*.test.ts       # implement-next pull-request claim

docs/do-work.md              # the "assign only when unassigned" rule, both surfaces
docs/git.md / README.md      # untouched (no install/quick-start/command-table change)
```

**Structure Decision**: The existing single-project layout is kept verbatim. The
feature adds no module: the decision is two fields on the existing `WorkItem`, and the
new `gh` wrapper belongs beside `assignIssueToAgent` in `src/github/ghWorkService.ts`,
which already owns the private `spawnSync` runner. A separate `assignment.ts` module
was considered and rejected — the whole rule is `assignees.length === 0`, and a module
for one expression is the indirection Principle III's "extract *shared* logic" clause
does not ask for.

## Complexity Tracking

> No Constitution Check violations; nothing to justify.
