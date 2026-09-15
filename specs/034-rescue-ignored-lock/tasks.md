---

description: "Task list for 034-rescue-ignored-lock"
---

# Tasks: Rescue survives an ignored run lock, and pre-flight failures are reported separately

**Input**: Design documents from `/specs/034-rescue-ignored-lock/`

**Prerequisites**: spec.md, plan.md, research.md

**Tests**: included — the spec asks for regression coverage explicitly (issue #69, "Suggested regression coverage").

## Format: `[ID] [P?] [Story] Description`

## Phase 1 — Setup

- [X] T001 Reproduce the defect against a scratch repository and record the exact git behaviour in `specs/034-rescue-ignored-lock/research.md`.

## Phase 2 — User Story 1: rescue works when the run lock is gitignored (P1)

- [X] T002 [US1] Add failing tests in `tests/unit/gitService.hygiene.test.ts` for `stageAllExcept`: an ignored exclusion is dropped from the pathspec, a tracked exclusion is kept, and an all-dropped list falls back to bare `git add -A`.
- [X] T003 [US1] Add `pathIsIgnored(path)` to `src/git/gitService.ts` running `git check-ignore -q -- <path>`, true only on exit 0.
- [X] T004 [US1] Filter `stageAllExcept`'s exclusions through `pathIsIgnored` in `src/git/gitService.ts`, keeping the existing no-pathspec form when nothing remains.
- [X] T005 [US1] Add a test in `tests/unit/repoHygiene.test.ts` covering the reported tick: dirty tracked file + ignored lock → the rescue commits, pushes and opens the draft PR.

## Phase 3 — User Story 2: no phantom recovery branch (P2)

- [X] T006 [US2] Add a test in `tests/unit/repoHygiene.test.ts` asserting no branch is created when staging fails.
- [X] T007 [US2] Reorder `rescueUncommittedChanges` in `src/git/repoHygiene.ts` to stage before creating the recovery branch.
- [X] T008 [US2] Add a test in `tests/unit/repoHygiene.test.ts` asserting the branch the rescue created is not a prune deletion candidate in the same tick.
- [X] T009 [US2] Thread the rescue's created branch name from `rescueUncommittedChanges` into `prune`/`collectCandidates` in `src/git/repoHygiene.ts`.

## Phase 4 — User Story 3: per-item skips name the pre-flight cause (P2)

- [X] T010 [US3] Add tests in `tests/unit/repoHygiene.test.ts` for `describePreflightFailures`: clean, rescue-only, base-only, both.
- [X] T011 [US3] Implement `describePreflightFailures(report)` in `src/git/repoHygiene.ts`.
- [X] T012 [US3] Add a test in `tests/unit/doWork.cmd.test.ts` asserting a skipped item's line and detail carry the pre-flight causes, and are unchanged when the pre-flight was clean.
- [X] T013 [US3] Pass the tick's pre-flight causes into `processItem` in `src/commands/doWork.ts` and append them to the skip progress line and the item detail.

## Phase 5 — User Story 4: documentation (P3)

- [X] T014 [US4] Document the ignored-run-lock rescue behaviour and the diverged-base-branch operator recovery in `docs/do-work.md`.

## Phase 6 — Polish

- [X] T015 Run `npm test && npm run lint` and fix everything they report.
- [X] T016 Confirm `README.md` needs no change (no installation, quick-start, command-table or dev-setup change).

## Dependencies

- T002 → T003 → T004 (tests first, then the predicate, then its use)
- T006 → T007; T008 → T009
- T010 → T011 → T012 → T013
- All of Phases 2–5 precede T015.
