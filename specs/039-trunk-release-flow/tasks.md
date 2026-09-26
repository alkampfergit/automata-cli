# Tasks: Trunk-based release flow

**Feature**: `feature/039-trunk-release-flow` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

`[P]` marks tasks that touch disjoint files.

## Phase 1 — Pure module (US1, US3)

- [X] **T001** Create `tests/unit/releaseFlow.test.ts`: `isReleaseFlow`, `describeReleaseFlowSource` for each source,
  `invalidReleaseFlowMessage`, `planRelease` for gitflow (with both trunk checkout forms) and for trunk (exactly three
  steps, no `develop`, no `release/`, no `merge`).
- [X] **T002** Create `src/git/releaseFlow.ts` so T001 passes; move the gitflow step list there verbatim.

## Phase 2 — Git service (US1, US2, US3)

- [X] **T003** Add `probeRemoteBranch(branch)` to `gitService.ts` (exit 0 → exists, 2 → absent, else error).
- [X] **T004** Add `resolveReleaseFlow()`: raw config → validation → probe of `develop`.
- [X] **T005** Change `checkReleasePreconditions(expectedBranch)`, keeping the `develop` message wording.
- [X] **T006** Make `publishRelease(version, dryRun, trunk, flow)` run `planRelease(...)`.
- [X] **T007** Extend `tests/unit/publishRelease.test.ts`: the probe outcomes, resolution (config, invalid, present,
  absent, error), the trunk argv, and a trunk dry run executing none of the mutators.

## Phase 3 — Command (US1, US2)

- [X] **T008** In `src/commands/git.ts`, resolve the flow after the trunk, run the preconditions with the expected
  branch, print the flow line, pass the flow to `publishRelease`, and update the description and help text.
- [X] **T009** Extend `tests/unit/git.commands.test.ts`: a `develop-probe` class in `classifyGitCall`, and trunk-flow
  cases (detected dry run, real run order, off-trunk refusal, behind refusal, configured flow skips the probe, invalid
  config, probe failure) plus the gitflow flow line.

## Phase 4 — Configuration (US3)

- [X] **T010** [P] Add `releaseFlow?: ReleaseFlow` to `AutomataGitConfig`.
- [X] **T011** [P] Add `config set git-release-flow <gitflow|trunk>` and its tests in `tests/unit/config.cmd.test.ts`.
- [X] **T012** [P] Add the `git-release-flow` wizard menu screen and update `tests/unit/ConfigWizard.test.tsx`.

## Phase 5 — Documentation

- [X] **T013** Update the `publish-release` section of `docs/git.md`: flows, detection, trunk sequence, CI expectation,
  failed-push recovery.
- [X] **T014** [P] Document `git.releaseFlow` in `docs/config.md`.
- [X] **T015** [P] Add an `## [Unreleased]` entry to `CHANGELOG.md`; record the feature in `AGENTS.md`.

## Phase 6 — Gate

- [X] **T016** Prove the new tests by mutation (restore the file from a `cp` backup).
- [X] **T017** `npm test && npm run lint` are green.
