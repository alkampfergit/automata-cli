# Implementation Plan: Rescue survives an ignored run lock, and pre-flight failures are reported separately

**Branch**: `feature/034-rescue-ignored-lock` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/034-rescue-ignored-lock/spec.md`

## Summary

`do-work`'s pre-flight rescue stages with `git add -A -- . ':(exclude).automata/automata.lock'`. In any
checkout that gitignores the run lock, git exits 1 with "the following paths are ignored" even though it
staged everything correctly, so the rescue aborts, the tree stays dirty, and every discovered item is
skipped as `dirty-tree`. The fix drops exclusions git already ignores (and does not track) from the
pathspec, reorders the rescue so no recovery branch is created before staging succeeds, protects the
rescue's branch from the same tick's prune, and carries the pre-flight rescue and base failures onto the
per-item skip lines so the two are readable separately.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js 22.12+ runtime

**Primary Dependencies**: commander.js; `node:child_process` `spawnSync` via `src/git/gitService.ts`

**Storage**: N/A — operates on the git working tree

**Testing**: vitest (`tests/unit/`), with `spawnSync` mocked for argv assertions and the service modules
mocked for sequencing assertions

**Target Platform**: Linux/macOS developer and CI checkouts

**Project Type**: CLI

**Performance Goals**: one extra `git check-ignore` process per exclusion per tick (currently one)

**Constraints**: no step may discard uncommitted work; behaviour in checkouts that do not ignore the run
lock must be unchanged

**Scale/Scope**: three source files, one docs page, three test files

## Constitution Check

| Principle | Compliance |
|---|---|
| I. CLI-First Design | No new command or flag; exit codes unchanged (a degraded pre-flight still exits 2) |
| II. TypeScript Strictness | New helpers carry explicit types; no `any` |
| III. Single Responsibility | `gitService` keeps owning git argv, `repoHygiene` keeps owning sequencing and decisions, `doWork` keeps owning reporting |
| IV. npm Distribution | No dependency added |
| V. Simplicity | One predicate (`git check-ignore`), one reorder, one extra untouchable branch, one description helper — no new abstraction |

No violations; no Complexity Tracking entries needed.

## Structure

Existing files only:

```
src/git/gitService.ts      # + pathIsIgnored(); stageAllExcept() filters its exclusions
src/git/repoHygiene.ts     # rescue reorder; prune protection; describePreflightFailures()
src/commands/doWork.ts     # per-item skip lines and details carry the pre-flight causes
docs/do-work.md            # ignored-lock behaviour + diverged-base recovery
tests/unit/gitService.hygiene.test.ts
tests/unit/repoHygiene.test.ts
tests/unit/doWork.cmd.test.ts
```

**Structure Decision**: no new module. Each change lands in the module that already owns that concern,
which is what Principle III requires and keeps the diff reviewable against the reported defect.

## Phase 0 — Research

See [research.md](./research.md). Five decisions, all resolved: ignored-path detection via
`git check-ignore`, stage-before-branch ordering, prune protection for the rescue branch, appended
pre-flight causes on per-item skips, and no automatic recovery for a diverged base branch.

## Phase 1 — Design

### `gitService.pathIsIgnored(path): boolean`

`git check-ignore -q -- <path>`; true only on exit 0. Any other status (including 128) answers false, so
the exclusion survives and behaviour degrades to today's.

### `gitService.stageAllExcept(excludePaths)`

Filters `excludePaths` through `pathIsIgnored`, then behaves exactly as before on what remains — including
the existing "no pathspec at all when the list is empty" branch, which now also covers "every exclusion
was dropped".

### `repoHygiene.rescueUncommittedChanges`

Order becomes: detect target → dry-run report → **stage** → create branch (when the target is new) →
commit → push → pull request. Failure outcomes and their `RescueStep` values are unchanged.

### `repoHygiene` prune protection

`rescueUncommittedChanges` already returns the branch name for `rescued`, `would-rescue` and (now) the
`failed` outcomes that got as far as naming one. `runRepoHygiene` threads that name into `prune`, which
adds it to `collectCandidates`'s untouchable set.

### `repoHygiene.describePreflightFailures(report): string[]`

Returns at most two strings — one for a failed rescue, one for a failed base preparation — each naming the
step and git's error text. Empty when the pre-flight was clean.

### `doWork.processItem`

When `prepareBaseBranch`/`preparePrBranch` fails and the tick's hygiene report has causes, the progress
line and the item's `detail` gain ` [pre-flight: <cause>; <cause>]`. With no causes the wording is
byte-for-byte what it is today.

## Phase 2 — Tasks

Generated in [tasks.md](./tasks.md).
