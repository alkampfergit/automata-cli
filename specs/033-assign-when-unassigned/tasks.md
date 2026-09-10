# Tasks: Claim an unassigned issue and pull request for the agent

**Feature**: `feature/033-assign-when-unassigned`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Task ordering is dependency-driven. `[P]` marks tasks that may run in parallel with
the others in the same phase.

## Phase 1 — Foundations: fetch and expose assignee state

- [X] **T001** Add `assignees: string[]` to `PrSurface` in `src/github/ghWorkService.ts`,
  add `assignees` to the `RawPrView` interface, add `assignees` to the
  `gh pr view --json` field list in `getPrSurface()`, and normalise it with the
  existing `login()` helper the way `getIssueSurface()` already does.
- [X] **T002** Add `assignPrToAgent(prNumber, agentUser)` to
  `src/github/ghWorkService.ts`, running `gh pr edit <n> --add-assignee <login>`,
  throwing on non-zero status with the same message shape as `assignIssueToAgent`.
  Update `assignIssueToAgent`'s doc comment to state the new "only when unassigned"
  contract of its caller.
- [X] **T003** [P] Add `assignees` to `getCurrentBranchPr()`'s `--json` field list and
  return type in `src/config/githubService.ts`, normalising an absent field to `[]`.
- [X] **T004** Extend `tests/unit/ghWorkService.test.ts`: `getPrSurface` exposes
  flattened assignees; an absent `assignees` field yields `[]`; `assignPrToAgent`
  issues `["pr","edit","42","--add-assignee","automata-bot"]`; `assignPrToAgent`
  throws on failure.

## Phase 2 — User Story 1: the issue claim rule (P1)

- [X] **T005** In `src/github/workDetection.ts`, change `needsAssignment` to
  `issueSurface.assignees.length === 0`, delete `isAssignedToAgent()`, and update the
  `WorkItem.needsAssignment` doc comment to "True when the issue has no assignee at
  all".
- [X] **T006** Rewrite the two existing assignment tests in
  `tests/unit/workDetection.test.ts` to the new rule and add the missing cases:
  empty list → `true`; `["alice"]` → `false`; `["AUTOMATA-BOT"]` → `false`;
  `["alice","AUTOMATA-BOT"]` → `false`.
- [X] **T007** Update `claimIssue()`'s doc comment in `src/commands/doWork.ts` to
  describe the new rule (the guard itself already reads `item.needsAssignment`).

## Phase 3 — User Story 2: the pull request claim (P1)

- [X] **T008** Add `prNeedsAssignment: boolean` to `WorkItem` in
  `src/github/workDetection.ts`: `false` on the discuss-turn branch, and
  `surface.assignees.length === 0` on the build-turn branch.
- [X] **T009** Add `prNeedsAssignment` cases to `tests/unit/workDetection.test.ts`:
  build turn with no PR assignees → `true`; with any assignee → `false`; discuss turn
  → always `false`.
- [X] **T010** Add `claimPr(prNumber, settings)` to `src/commands/doWork.ts`, advisory
  in the same shape as `claimIssue`, and call it right after `claimIssue(item, settings)`
  in `processItem` when the turn is `pr-work`, a pull request is known, and
  `item.prNeedsAssignment` is true.
- [X] **T011** In `repairIssueLink()` (`src/commands/doWork.ts`), claim the pull request
  returned by `getCurrentBranchPr()` when its assignee list is empty — on both exit
  paths that found a pull request (already-linked and just-linked), so a re-run of a
  discuss turn still claims an unassigned pull request.
- [X] **T012** Extend `tests/unit/doWork.cmd.test.ts`: a build turn on an unassigned
  pull request calls the pull-request assign; a build turn on an assigned one does
  not; a discuss turn that opens a pull request claims it; a failing claim warns and
  leaves the item's outcome unchanged.

## Phase 4 — User Story 3: plan and JSON reporting (P2)

- [X] **T013** Update `describePlannedRun()`'s `Assignment` line in
  `src/commands/doWork.ts` to report both surfaces, and `describePlan()`'s per-item
  claim suffix to mention the pull request when `prNeedsAssignment` is true.
- [X] **T014** Add `prNeedsAssignment` to `toPlanJson()` in `src/commands/doWork.ts`.
- [X] **T015** Extend `tests/unit/doWork.cmd.test.ts` for the dry-run text in each
  assignment state, and fix any existing `--json` plan assertion that compares the
  whole object with `toEqual`.

## Phase 5 — User Story 4: `implement-next` (P3)

- [X] **T016** In `linkPrToIssue()` (`src/commands/getReady.ts`), claim the pull
  request for `config.agentUser` (falling back to `@me`) when its assignee list is
  empty, using the existing `warnOnFailure()` wrapper so it stays advisory.
- [X] **T017** Add a test covering the `implement-next` pull-request claim: claimed
  when unassigned, skipped when assigned, warning on failure.

## Phase 6 — Documentation and gates

- [X] **T018** Update `docs/do-work.md`: replace the current issue-claim description
  with the "assign only when unassigned" rule for both surfaces, note that an issue
  owned by a human is left alone, and document the dry-run reporting.
- [X] **T019** Document the `implement-next` pull-request claim in the relevant
  command-group page.
- [X] **T020** Typecheck the touched test files explicitly
  (`npx tsc --noEmit --strict …`), since `tsconfig.json` covers only `src` and vitest
  does not typecheck.
- [X] **T021** Run `npm test` and the real lint gate (`rtk proxy npm run lint` /
  `npx eslint src/`); check new or heavily edited files with `npx prettier --check`
  individually rather than reformatting the tree.

## Dependencies

- T004 depends on T001–T003.
- Phase 2 (T005–T007) depends on nothing in Phase 1 and could ship alone.
- T008 depends on T001; T010–T011 depend on T002, T003 and T008.
- Phase 4 depends on T008.
- Phase 5 depends on T002 and T003 only.
- Phase 6 depends on everything.
