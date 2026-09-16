# Tasks: Explicit branch-synchronisation strategy for `do-work`

**Feature Branch**: `feature/036-explicit-rebase-sync` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Ordering: the git primitives come first because everything else calls them (T003 → T005), the sequencing change forces
the reporting change (T005 → T007 → T008), and the documentation (T011–T014) is independent of the tests once the
behaviour is settled. The dependency refresh (T015–T016) touches nothing the rest of the branch touches and may run at
any point `[P]`.

## Phase 1: Establish the git facts

- [ ] **T001** Reproduce issue #73's shape in a throw-away repository (same parent, same tree, different sha) and record
  the `git cherry` and `git rebase` output in `research.md`. *(FR-004)*
- [ ] **T002** Measure the two behaviours the safety predicate depends on and record them in `research.md`: `git cherry`
  omits merge commits, and `git rebase` exits non-zero on a conflict while `git rebase --abort` restores the exact
  pre-rebase sha. *(FR-004, FR-006)*

## Phase 2: Git primitives (`src/git/gitService.ts`)

- [ ] **T003** Add `DivergenceReport` / `DivergentCommit` types and `describeDivergence(upstream, head)`: parse
  `git cherry <upstream> <head>` into `{ sha, alreadyUpstream }[]`, plus `merges` from
  `git rev-list --count --merges <upstream>..<head>`. Return `null` when either command fails, so an unreadable
  repository can never read as "safe". *(FR-004)*
- [ ] **T004** Add `rebaseOnto(ref)` (`git rebase <ref>`) and `abortRebase()` (`git rebase --abort`), both returning
  `GitCommandResult`. *(FR-004, FR-006)*
- [ ] **T005** Change `checkoutAndPull`'s `git pull` to `git pull --ff-only`. *(FR-010)*

## Phase 3: Tests for the primitives

- [ ] **T006** New `tests/unit/describeDivergence.git.test.ts` driving **real** `git` over `mkdtempSync` repositories:
  the equivalent-divergence case (`alreadyUpstream: true`), a genuinely new commit (`false`), an empty range, a range
  containing a merge commit (pinning that `cherry` omits it while `merges` counts it), and a bad ref (`null`). Use
  `stdio: ["pipe","pipe","pipe"]` so provoked git errors do not leak into the vitest output. *(SC-003)*

## Phase 4: The recovery sequence (`src/git/workspaceService.ts`)

- [ ] **T007** Add `SyncStrategy` (`fast-forward` | `tracking-branch` | `reset-to-remote` | `rebase`), make it a
  required field on the success variant of `PrepareResult`, add `rebase-conflict` to `PrepareFailureReason`, and set the
  strategy at every existing success site. *(FR-008)*
- [ ] **T008** Add `rebaseOntoAlreadyAppliedRemote(headRefName)`: refuse unless there is at least one local-only commit,
  `merges` is `0`, and every commit is `alreadyUpstream`; then `rebaseOnto`, and on failure `abortRebase` and return
  `rebase-conflict`. Call it from `preparePrBranch` after the force-push reset attempt. *(FR-002, FR-003, FR-004,
  FR-006)*
- [ ] **T009** Upgrade the `pull-failed` refusal message to name how many local commits are not upstream and the
  `git log origin/<branch>..<branch>` command to inspect them, keeping the existing reset instruction. *(FR-005)*

## Phase 5: Reporting

- [ ] **T010** `src/run/operationLog.ts`: add optional `TickLogItem.sync`, render ` sync=<v>` on the work-record line,
  and append an aggregate `sync=<strategy>:<n>,…` field to the execution line for every item whose `sync` is set and is
  not `fast-forward` or `tracking-branch`. Omit the field when there is nothing to report. *(FR-009)*
- [ ] **T011** `src/commands/doWork.ts`: carry the strategy (on success) or the failure reason (on refusal) onto
  `ItemReport`, print it on the item's progress line, and pass it through `toTickLogItem`. *(FR-008, FR-009)*

## Phase 6: Behavioural tests

- [ ] **T012** Extend `tests/unit/workspaceService.test.ts`: the rebase path succeeds and reports `rebase`; a merge
  commit in the range refuses; a non-upstream commit refuses without calling `rebaseOnto`; a conflicting rebase calls
  `abortRebase` and reports `rebase-conflict`; a plain fast-forward never calls `describeDivergence`; and every existing
  success case carries the right strategy. *(SC-003, SC-002)*
- [ ] **T013** Extend `tests/unit/operationLog.test.ts` for the `sync` field and the `sync=` summary, including the
  "absent when every item fast-forwarded" case. *(FR-009)*
- [ ] **T014** Extend `tests/unit/doWork.cmd.test.ts` for the progress line and the tick-log item, mocking the new
  `gitService` exports so the suite still imports. *(FR-008)*
- [ ] **T015** Prove the new tests are not vacuous by mutation: make the safety predicate accept everything (the refusal
  tests must go red) and drop the `abortRebase` call (the conflict test must go red).

## Phase 7: Documentation

- [ ] **T016** `docs/do-work.md` `[P]`: rewrite the "Force-pushed head branches" section into a branch-synchronisation
  section covering all three recoveries and the refusal, and add `rebase-conflict` wherever skip reasons are listed.
  *(FR-012)*
- [ ] **T017** `docs/git.md` `[P]`: `finish-feature`'s pull is `--ff-only`. *(FR-012)*
- [ ] **T018** `docs/wiki/Troubleshooting.md` `[P]`: rewrite the `pull-failed` row and add a `rebase-conflict` row.
  *(FR-012)*
- [ ] **T019** `CHANGELOG.md` `[P]`: bullets under `## [Unreleased]` for the recovery, the new skip reason, the
  `--ff-only` change in `finish-feature`, the operation-log field and the dependency refresh. *(FR-012)*

## Phase 8: Dependency refresh

- [ ] **T020** `[P]` Move `@types/node`, `prettier` and `vitest` to their current releases in `package.json` and
  regenerate `package-lock.json`. Leave `typescript` on 5.x per the constitution, and record that as an open item.
  *(FR-011)*
- [ ] **T021** `[P]` `rm -rf node_modules && npm ci`, then `npm run audit:prod` and `npm run audit:all` — both must
  report zero vulnerabilities. *(FR-011, SC-004)*

## Phase 9: Gate

- [ ] **T022** `npm test && npm run lint` green (use `rtk proxy npm run lint` or `npx eslint src/` to read the real
  gate), and `npx prettier --check` on each new file compared against its state on `develop`. *(SC-004)*
- [ ] **T023** `grep -rn` the docs for behavioural claims this branch falsifies (`--ff-only`, "never discards",
  `pull-failed`) and correct any that are now wrong. *(FR-012)*
