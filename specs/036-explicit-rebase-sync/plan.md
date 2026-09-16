# Implementation Plan: Explicit branch-synchronisation strategy for `do-work`

**Branch**: `feature/036-explicit-rebase-sync` | **Date**: 2026-09-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/036-explicit-rebase-sync/spec.md`

## Summary

`preparePrBranch` synchronises a pull-request branch with `git pull --ff-only` and, when that fails, recovers only from a
force push. A divergence made of commits that are *already applied upstream under a different sha* matches neither, so
the item is skipped as `pull-failed` on every tick forever (issue #73).

This feature adds a third, explicitly-named recovery: classify the local-only commits against the already-fetched
`refs/remotes/origin/<branch>` with `git cherry`, and rebase onto that ref when — and only when — every local-only commit
is already present upstream as an equivalent patch and none of them is a merge. Anything else is still refused, with a
message that names the commits. A conflicting rebase is aborted and reported under its own `rebase-conflict` reason. The
chosen strategy is printed on the item's progress line and recorded in the operation log. Alongside this, every npm
reference is refreshed and the changelog's `Unreleased` section is populated so a release can be cut.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js 22.12+ to run / 24 LTS to develop

**Primary Dependencies**: commander.js (CLI), `node:child_process` via `src/git/gitService.ts`'s `run()` — no new
runtime dependency

**Storage**: N/A. The operation log (`automata-execution.log`, `automata-work.log`) is a best-effort diagnostic file
outside the checkout; no schema change beyond one optional field.

**Testing**: vitest. `spawnSync`-mocked unit tests for sequencing, plus one real-`git` test over a `mkdtempSync`
repository for the divergence classification, following `tests/unit/stageAllExcept.git.test.ts`.

**Target Platform**: Linux/macOS developer machines and unattended containers running `do-work` from cron.

**Project Type**: Single-project CLI.

**Performance Goals**: The new classification runs only on the path that today refuses the item, and costs two
`git rev-list`-class invocations against refs already fetched. No extra network round trip.

**Constraints**: The unattended-safety contract in `src/git/workspaceService.ts` — never stash, reset or discard work
`do-work` did not create — is the binding constraint. No path added here may move a ref unless every commit past the
remote is provably already upstream.

**Scale/Scope**: Four source modules (`gitService`, `workspaceService`, `doWork`, `operationLog`), four doc pages, the
changelog, and the dependency refresh.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. CLI-First Design | No new command or flag. Existing `do-work` stdout/stderr split preserved; the new detail goes to stderr with the other per-item progress. `--json` per-item shape is unchanged. PASS |
| II. TypeScript Strictness | New exports (`DivergenceReport`, `SyncStrategy`, `describeDivergence`, `rebaseOnto`, `abortRebase`) carry explicit annotations; no `any`. `PrepareResult`'s success variant gains a required `strategy`, so an unhandled case is a compile error. PASS |
| III. Single Responsibility | The git invocations stay in `gitService`; the sequencing and the safety predicate stay in `workspaceService`; the reporting stays in `doWork`/`operationLog`. No logic crosses those lines. PASS |
| IV. npm Distribution | No new runtime dependency. The refresh keeps the `dependencies` block at three packages. PASS |
| V. Simplicity | No configuration key, no strategy abstraction — a fixed three-step sequence of plain functions. Rejected alternatives are in `research.md`. PASS |

Re-checked after Phase 1 design: no violation introduced. `Complexity Tracking` is therefore empty and omitted.

**Constitution note**: Principle II fixes the stack at "TypeScript 5.x". The dependency refresh therefore stops at the
newest 5.x release and does **not** adopt TypeScript 7, which would need a constitution amendment of its own. Recorded
as a decision in `research.md` and as an open item in `pr-report.md`.

## Project Structure

### Documentation (this feature)

```text
specs/036-explicit-rebase-sync/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── spec.md              # Feature specification
├── tasks.md             # Phase 2 output
├── pr-report.md         # Reviewer-facing summary
└── spec-decisions.md    # Planning decisions
```

No `data-model.md`, `quickstart.md` or `contracts/` — the feature adds no persisted entity, no new command to walk a
user through, and no external interface.

### Source Code (repository root)

```text
src/
├── git/
│   ├── gitService.ts        # + describeDivergence, rebaseOnto, abortRebase; checkoutAndPull becomes --ff-only
│   └── workspaceService.ts  # + SyncStrategy on PrepareResult, + rebase-conflict, + the rebase recovery
├── commands/
│   └── doWork.ts            # surfaces the strategy on the progress line and in the tick log item
└── run/
    └── operationLog.ts      # + optional TickLogItem.sync, work-record field, execution-line sync= summary

tests/unit/
├── workspaceService.test.ts     # existing suite extended: rebase, refusal, conflict, strategies
├── describeDivergence.git.test.ts  # new: real git, pins git cherry's behaviour incl. merge omission
├── operationLog.test.ts         # existing suite extended: sync field and sync= summary
└── doWork.cmd.test.ts           # existing suite extended: the progress line and the tick log item

docs/
├── do-work.md               # the branch-synchronisation section, the skip-reason table
├── git.md                   # finish-feature's pull is --ff-only
└── wiki/Troubleshooting.md  # pull-failed rewritten, rebase-conflict added

CHANGELOG.md                 # Unreleased bullets
package.json / package-lock.json  # dependency refresh
```

**Structure Decision**: The existing single-project layout is kept as-is. Every change lands in a module that already
owns the concern — there is no new directory and no new module, because the feature is a new branch in an existing
decision tree plus one new git primitive.
