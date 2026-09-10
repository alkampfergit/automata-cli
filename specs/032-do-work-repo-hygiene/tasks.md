---

description: "Task list for do-work pre-flight repository hygiene"
---

# Tasks: `do-work` pre-flight repository hygiene

**Input**: Design documents from `/specs/032-do-work-repo-hygiene/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Included. This repository requires a test for every change, including
configuration-only ones (see `.specify/memory/speckit-memory.md`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Foundation — service wrappers (blocking prerequisite)

No user story is deliverable without these; they are the only code allowed to spawn a process.

- [X] T001 Add the git wrappers `do-work` hygiene needs to `src/git/gitService.ts`, each returning
  the existing `GitCommandResult` shape or a typed value, and each documented with the reason its
  exact form was chosen:
  - `listLocalBranches(): string[]` — `git for-each-ref --format=%(refname:short) refs/heads`
  - `listRemoteBranches(): string[] | null` — `git ls-remote --heads origin`, parsing
    `<sha>\trefs/heads/<name>`; `null` on failure so callers can tell "no branches" from
    "could not ask"
  - `createBranchAtHead(branch): GitCommandResult` — `git checkout -b <branch>`
  - `stageAllExcept(excludePaths): GitCommandResult` — `git add -A -- . :(exclude)<p>…`
  - `commitStaged(message): GitCommandResult` — `git commit -m <message>`
  - `pushSetUpstream(branch): GitCommandResult` — `git push -u origin <branch>`
  - `countCommitsNotIn(baseBranch, branch): number | null` —
    `git rev-list --count <base>..<branch>`; `null` on failure or unparseable output
  - `forceDeleteLocalBranch(branch): GitCommandResult` — `git branch -D <branch>`, the
    non-throwing sibling of the existing `deleteLocalBranch`
- [X] T002 Add the two `gh` wrappers to `src/github/ghWorkService.ts`, with private `Raw…`
  interfaces for the CLI payloads and normalised exported types:
  - `listPullRequestsForHead(branch): PullRequestHeadRef[]` —
    `gh pr list --head <b> --state all --json number,state,url,updatedAt`, newest first
  - `createDraftPullRequest({ head, base, title, body, label }): { number: number; url: string }` —
    `gh pr create --draft …`, retried once without `--label` when the label does not exist
- [X] T003 [P] Unit-test every wrapper from T001 in `tests/unit/gitService.hygiene.test.ts` by
  asserting the exact argv passed to the mocked `spawnSync`, plus the `null`/failure paths of
  `listRemoteBranches` and `countCommitsNotIn`
- [X] T004 [P] Unit-test both wrappers from T002 in `tests/unit/ghWorkService.test.ts`: argv,
  newest-first ordering, the empty-array case, and that a missing label triggers exactly one
  retry without `--label` and still returns the created pull request

**Checkpoint**: `npm test` green; no behaviour visible to a user yet.

---

## Phase 2: US1 — Uncommitted work is rescued, not refused (P1) 🎯 MVP

- [X] T005 [US1] Create `src/git/repoHygiene.ts` with the types from `data-model.md`
  (`HygieneOptions`, `RescueOutcome`, `PruneCandidate`, `PruneOutcome`, `HygieneReport`) and an
  exported `runRepoHygiene(options): HygieneReport` whose body is the rescue step only
- [X] T006 [US1] Implement `rescueUncommittedChanges`: trigger on
  `hasUncommittedChanges([RUN_LOCK_RELATIVE_PATH])`; commit onto the current branch when it is
  not `baseBranch`, else create `rescue/<source>-<YYYYMMDDTHHMMSSZ>` at HEAD; stage with the
  run-lock exclusion; commit with `chore(automata): rescue uncommitted work from <source>`;
  `push -u`; open a draft pull request only when the branch has no open one. Return the exact
  `RescueOutcome` variant for each path, and `failed` with the step name on any failure
- [X] T007 [US1] Handle detached HEAD as the base-branch case, and never commit to or push
  `baseBranch`
- [X] T008 [US1] Honour `dryRun`: report `would-rescue` and issue no mutating call
- [X] T009 [US1] Call `runRepoHygiene` from `runTick` in `src/commands/doWork.ts` — inside the run
  lock, before `discoverIssues` — and thread the report through to reporting
- [X] T010 [US1] Report the pre-flight: a `Pre-flight:` block on stderr as it runs, a section in
  `summarize()`, a `preflight` object in the `--json` payload, and inclusion in `reportDryRun`
- [X] T011 [US1] Fold `report.degraded` into the tick's exit code: force 2 where the tick would
  otherwise return 0, leaving exit 1 untouched
- [X] T012 [P] [US1] Unit-test the rescue in `tests/unit/repoHygiene.test.ts`: clean tree does
  nothing; base-branch HEAD creates a `rescue/*` branch; feature-branch HEAD commits in place;
  an existing open pull request suppresses a second one; the run lock is excluded from staging;
  each failure step returns `failed` and issues no further mutating call
- [X] T013 [P] [US1] Extend `tests/unit/doWork.cmd.test.ts`: the pre-flight runs exactly once per
  tick, before issue discovery, and a degraded report turns exit 0 into exit 2

**Checkpoint**: US1 independently deliverable — a dirty tree no longer stalls the loop.

---

## Phase 3: US2 — The base branch is always up to date (P2)

- [X] T014 [US2] Add the base step to `runRepoHygiene`: `checkoutBranch(baseBranch)` then
  `pullFastForwardOnly()`, after the rescue, populating `report.base`
- [X] T015 [P] [US2] Unit-test in `tests/unit/repoHygiene.test.ts`: it runs with zero actionable
  work, it runs after the rescue, a failed checkout and a failed (non-fast-forward) pull each
  produce the right `base` failure and mark the report degraded, and no merge/rebase/reset is
  ever issued

**Checkpoint**: the checkout ends every tick on the base branch at the remote's tip.

---

## Phase 4: US3 — Dead local branches are pruned (P3)

- [X] T016 [US3] Add the prune step to `runRepoHygiene`, after the base step: list local and
  remote branches, exclude `baseBranch`, the current branch and `protectedBranches`, and keep only
  names absent from the remote listing. Bail out of the whole step when the remote listing failed
- [X] T017 [US3] Per candidate: `listPullRequestsForHead`; keep on an `OPEN` pull request; keep
  with reason `lookup-failed` when the call throws; otherwise `countCommitsNotIn(base, branch)` —
  `0` deletes, `> 0` pushes and opens a draft pull request and keeps, `null` keeps as
  `lookup-failed`
- [X] T018 [US3] Honour `dryRun` with `would-delete` / `would-rescue`
- [X] T019 [P] [US3] Unit-test the full decision table in `tests/unit/repoHygiene.test.ts`, one
  case per acceptance scenario of US3, including that a branch present on the remote is never a
  candidate and that a failed `git branch -D` is reported as `kept`/`delete-failed`

**Checkpoint**: the branch list stops growing without operator intervention.

---

## Phase 5: US4 — Inspectability (P3)

- [X] T020 [US4] Verify and complete `--dry-run` end to end: assert in
  `tests/unit/repoHygiene.test.ts` that a dry run issues no call from the mutating set
  (`createBranchAtHead`, `stageAllExcept`, `commitStaged`, `pushSetUpstream`, `checkoutBranch`,
  `pullFastForwardOnly`, `forceDeleteLocalBranch`, `createDraftPullRequest`)
- [X] T021 [US4] Assert in `tests/unit/doWork.cmd.test.ts` that `--dry-run` reports the pre-flight
  and that `--json` carries the `preflight` object in both dry-run and real form

---

## Phase 6: Polish & documentation

- [X] T022 Document the pre-flight in `docs/do-work.md`: a new section covering all three steps
  and their safety rules, the amended "How it works" step order, the amended exit-code notes, and
  the amended "What `do-work` never does" list (a dirty tree no longer skips the item)
- [X] T023 Confirm `README.md` needs no change — no installation, quick-start, command-group or
  dev-setup change (per the documentation convention in `AGENTS.md`)
- [X] T024 Run `npm test && npm run lint` (reading the real lint gate with `npx eslint src/`, per
  memory) and `npx prettier --check` on the new files individually; fix what the gate reports

---

## Phase 7: Converge — a merged pull request outranks the commit count

Added after implementation. A `--dry-run` against this repository queued `feature/update-spec-kit`
for a *rescue* because none of its three commits are in `develop` — but its pull request #33 was
squash-merged, so the change is in `develop` and only the commits are not. Kept as a separate
phase so the original run's record stays intact.

- [X] T025 Reorder the per-candidate decision in `src/git/repoHygiene.ts`: open pull request →
  keep; **merged** pull request → delete without reading the commit count; otherwise the count
  decides. A pull request closed without merging counts as no pull request. Factor the shared
  delete-or-report path into one helper that logs which rule fired
- [X] T026 Extend `tests/unit/repoHygiene.test.ts`: a squash-merged branch is deleted and
  `countCommitsNotIn` is never called; a merged pull request wins over a newer closed one; a
  branch whose only pull request was closed without merging still falls through to the count
- [X] T027 Update `spec.md` (FR-009/FR-009a, US3 scenarios, edge cases, assumptions),
  `data-model.md`, `research.md` and `spec-decisions.md` with the converge decision and the
  evidence that produced it
- [X] T028 Update the prune table and the "never does" list in `docs/do-work.md`, and the
  matching line in `docs/wiki/Operations.md`
- [X] T029 Re-run the real dry run against this repository and confirm `feature/update-spec-kit`
  is now reported as `would delete … (no remote, PR #33 was merged)`

---

## Phase 8: Review round (Copilot findings + a closed pull request settles the branch)

Two Copilot findings on the second review pass, plus a decision on issue #47: *"if the pull
request is closed, then we can assume that the branch is not needed anymore"* — which reverses
T025's "a closed pull request counts as no pull request".

- [X] T030 `src/git/repoHygiene.ts`: a candidate whose pull request is `CLOSED` without merging is
  deleted without consulting the commit count, ranked after `MERGED` and after the `OPEN` keep.
  Update the module header, which claimed deletion needs a confirmed zero commit count
- [X] T031 `src/git/repoHygiene.ts`: add `push-failed` to `PruneKeptReason` and use it when
  `pushSetUpstream` fails, instead of reporting a push failure as `lookup-failed`
- [X] T032 `src/github/ghWorkService.ts`: replace the `/label/i` test that gated the retry without
  `--label` with `isMissingLabelError`, an exported predicate matching only the missing-label
  messages, so a 403 or a rate limit that mentions labels surfaces instead of being retried
- [X] T033 Tests: the closed-pull-request branch is deleted and `countCommitsNotIn` is never
  called; a closed plus an open pull request still keeps the branch; a failed push reports
  `push-failed`; `isMissingLabelError` accepts the four gh phrasings and rejects the three
  label-mentioning failures
- [X] T034 Update `spec.md` (US3 scenario 2b, FR-009a/FR-009b, edge cases) and the prune table,
  reasoning and "never does" list in `docs/do-work.md`

---

## Dependencies

```text
Phase 1 (T001–T004) ─┬─> Phase 2 (US1, T005–T013)
                     ├─> Phase 3 (US2, T014–T015)   [needs T005 for the module]
                     └─> Phase 4 (US3, T016–T019)   [needs T005; ordered after US2 in the code]
Phase 2/3/4 ────────────> Phase 5 (US4, T020–T021)
All ────────────────────> Phase 6 (T022–T024)
Phase 6 ────────────────> Phase 7 (converge, T025–T029)
Phase 7 ────────────────> Phase 8 (review round, T030–T034)
```

`[P]` tasks within a phase touch different files and can be done in any order.
