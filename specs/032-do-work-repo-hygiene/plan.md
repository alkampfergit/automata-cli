# Implementation Plan: `do-work` pre-flight repository hygiene

**Branch**: `feature/032-do-work-repo-hygiene` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/032-do-work-repo-hygiene/spec.md`

## Summary

Give `do-work` a once-per-tick repository-hygiene pre-flight that runs inside the run lock and
before issue discovery. It rescues uncommitted changes into a branch with a pushed draft pull
request instead of letting every item skip on `dirty-tree`, checks out and fast-forwards the
base branch unconditionally, then deletes local branches that exist on no remote and have no
open pull request — pushing them with a draft pull request instead of deleting when they carry
commits the base branch does not already have.

The git and `gh` invocations go into the two modules that already own their process runners
(`src/git/gitService.ts`, `src/github/ghWorkService.ts`); the sequencing and the
keep/delete/rescue decisions go into a new sibling module `src/git/repoHygiene.ts`, next to the
existing `src/git/workspaceService.ts` which sequences the *per-item* checkout.

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`, no `any`)

**Primary Dependencies**: commander.js (CLI), `node:child_process` `spawnSync` via the existing
private runners in `gitService`/`ghWorkService`, `gh` CLI, `git`

**Storage**: N/A — the feature's state is the git checkout itself

**Testing**: vitest, unit tests that `vi.mock` the service modules (the pattern in
`tests/unit/workspaceService.test.ts` and `tests/unit/doWork.cmd.test.ts`)

**Target Platform**: Node.js 22.12+ CLI on Linux/macOS

**Project Type**: single-project CLI

**Performance Goals**: the pre-flight must add at most a bounded, small number of subprocess
calls per tick — one remote listing rather than one per branch, and a `gh` lookup only for
branches already proven remote-less

**Constraints**: never discard work — no `stash`, `reset`, `clean`, `checkout --force`, or
non-fast-forward merge anywhere in the feature; never push to or commit on the base branch;
`--dry-run` must mutate nothing

**Scale/Scope**: three new decision paths in one new module, ~8 new service wrappers, one new
call site in `runTick`, one docs page section

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. CLI-First Design | No new command or flag. The pre-flight reports on stderr (progress) and stdout (summary) like the rest of the tick, honours the existing `--json` and `--dry-run`, and folds into the documented exit codes. **Pass.** |
| II. TypeScript Strictness | New exported types (`HygieneReport`, `RescueOutcome`, `PruneOutcome`) are explicit interfaces/discriminated unions; `gh --json` payloads get private `Raw…` interfaces and are normalised before crossing the module boundary; no `any`. **Pass.** |
| III. Single Responsibility | The new behaviour is pre-flight state management, not a second job bolted onto `do-work` — `do-work` already owns "put the checkout where the tick needs it" through `workspaceService`. Process runners are reused, not duplicated. **Pass.** |
| IV. npm Distribution | No new dependency, no build change. **Pass.** |
| V. Simplicity | No new config key, no new flag, no abstraction layer: one module, plain functions, callbacks only for the log sink so the tick keeps owning its stdout/stderr split. **Pass.** |

Re-check after Phase 1 design: still passing — the design added no module beyond
`src/git/repoHygiene.ts` and no dependency.

## Project Structure

### Documentation (this feature)

```text
specs/032-do-work-repo-hygiene/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── tasks.md             # Phase 2 output
├── pr-report.md         # Reviewer-facing summary
└── spec-decisions.md    # Planning decisions
```

### Source Code (repository root)

```text
src/
├── commands/
│   └── doWork.ts             # MODIFIED: run the pre-flight in runTick; report it in
│                             #   summarize(), the --json payload and the dry-run output
├── git/
│   ├── gitService.ts         # MODIFIED: new low-level git wrappers (branch listing,
│                             #   remote head listing, create branch, stage-all, commit,
│                             #   push -u, unmerged-commit count, force-delete)
│   ├── repoHygiene.ts        # NEW: sequencing + keep/delete/rescue decisions
│   └── workspaceService.ts   # UNCHANGED: still the per-item checkout guard
└── github/
    └── ghWorkService.ts      # MODIFIED: list a head branch's pull requests in any state;
                              #   create a draft pull request

tests/unit/
├── repoHygiene.test.ts       # NEW: the decision table and the ordering guarantees
├── gitService.hygiene.test.ts# NEW: argv of each new git wrapper
├── ghWorkService.test.ts     # MODIFIED: the two new gh wrappers
└── doWork.cmd.test.ts        # MODIFIED: pre-flight is invoked once per tick, inside the
                              #   lock, before discovery, and honours --dry-run

docs/do-work.md               # MODIFIED: pre-flight section, "How it works" step order,
                              #   exit codes, and the "never does" list
```

**Structure Decision**: single project, flat module layout under `src/`, matching the
constitution's "prefer flat module structure". `repoHygiene.ts` sits beside
`workspaceService.ts` because they are the same kind of thing — a sequencer over
`gitService`'s runner — differing only in scope (whole-tick vs per-item). It does **not** go
inside `doWork.ts`, which is already 1250 lines, nor inside `gitService.ts`, which owns the
runner and must stay free of policy.

## Complexity Tracking

> No Constitution Check violations; section intentionally empty.
