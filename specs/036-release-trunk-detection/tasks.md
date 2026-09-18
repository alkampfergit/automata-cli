# Tasks: Release Trunk Detection

**Feature**: `feature/036-release-trunk-detection` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Task IDs are referenced from commit messages and from the PR report. `[P]` marks tasks that touch
disjoint files and could run in parallel.

## Phase 1 — Pure detection module (US1, US3)

- [X] **T001** Create `src/git/trunkDetection.ts` with `TrunkSource`, `TRUNK_CANDIDATES`,
  `parseOriginHeadRef`, `parseLsRemoteSymref`, `describeTrunkSource` and `unresolvedTrunkMessage`.
  All pure; no imports from `node:child_process`.
- [X] **T002** Create `tests/unit/trunkDetection.test.ts` covering: `origin/HEAD` output parsed to a
  bare name, empty output → `null`, a slash-bearing branch name, the tab-separated `ls-remote`
  symref line, a symref line with no `ref:` prefix → `null`, and the wording of both message builders.

## Phase 2 — Git service (US1, US2)

- [X] **T003** Add `remoteBranchExists(branch)` to `src/git/gitService.ts` as the positive-sense
  wrapper over the existing `isUpstreamGone` probe.
- [X] **T004** Add `resolveTrunkBranch(): TrunkResolution` implementing D-001 (config →
  `symbolic-ref refs/remotes/origin/HEAD` → `ls-remote --symref origin HEAD` → probe
  `TRUNK_CANDIDATES`), returning the source alongside the branch.
- [X] **T005** Add `fetchTrunkAndTags(trunk)` running
  `git fetch --tags origin +refs/heads/<trunk>:refs/remotes/origin/<trunk>` (D-002) and returning a
  result object carrying git's stderr on failure.
- [X] **T006** Replace `getLatestTagOnMaster()` with `getLatestTagOnTrunk(ref)` (D-004) and update its
  export.
- [X] **T007** Add `localBranchExists(branch)` (`git rev-parse --verify --quiet refs/heads/<branch>`)
  and `trunkBehindCount(trunk)` (`git rev-list --count refs/heads/<t>..refs/remotes/origin/<t>`,
  D-005), with the existence guard.
- [X] **T008** Change `publishRelease(version, dryRun, trunk)` to emit the trunk name in the checkout,
  merge, tag and push steps, choosing `git checkout <trunk>` or `git checkout -b <trunk>
  origin/<trunk>` by local existence (D-003).

## Phase 3 — Command wiring (US1, US2)

- [X] **T009** In `src/commands/git.ts`, run trunk resolution after the clean-tree precondition; on
  failure print `unresolvedTrunkMessage` and exit 1.
- [X] **T010** Report the resolved trunk and its source on stdout (FR-011).
- [X] **T011** Run the fetch before version inference, in dry-run too; exit 1 on failure (FR-004/005).
- [X] **T012** Point version inference at `origin/<trunk>` and reword the "no semver tag" error to
  name that ref (FR-006/007).
- [X] **T013** Add the behind-check precondition after the tag-existence check and before
  `publishRelease` (FR-008).
- [X] **T014** Update the `--argument`/`addHelpText` release-sequence text to say `<trunk>` and
  describe detection.

## Phase 4 — Configuration (US3)

- [X] **T015** Add `AutomataGitConfig` and `git?: AutomataGitConfig` to `src/config/configStore.ts`.
- [X] **T016** [P] Add `automata config set git-trunk-branch <value>` to `src/commands/config.ts`,
  rejecting an empty value like its siblings.
- [X] **T017** [P] Append a `Git` entry to `MAIN_MENU_OPTIONS` in `src/config/ConfigWizard.tsx` with a
  `git-trunk-branch` text screen; blank saves `undefined`.

## Phase 5 — Tests

- [X] **T018** Update `tests/unit/publishRelease.test.ts`: rename the `getLatestTagOnMaster` block,
  assert the `origin/<trunk>` argv, add resolution/fetch/behind-count cases, and rewrite the dry-run
  test to assert an explicit `MUTATORS` list is absent rather than "spawnSync never ran".
- [X] **T019** Update `tests/unit/git.commands.test.ts` publish-release preconditions for the new
  call sequence, and add cases for: unresolvable trunk, failed fetch, behind local trunk, and a
  configured override skipping detection.
- [X] **T020** [P] Add a `config set git-trunk-branch` case to the config command tests.
- [X] **T021** [P] Update `tests/unit/ConfigWizard.test.tsx` for the new main-menu entry and screen.
- [X] **T022** Prove the new tests are not vacuous by mutation (revert each mutation afterwards).

## Phase 6 — Documentation

- [X] **T023** Rewrite the `publish-release` section of `docs/git.md`: detection, the fetch, the new
  preconditions table rows, the release sequence with `<trunk>`, and the config override.
- [X] **T024** [P] Document `git.trunkBranch` in `docs/config.md` (table row, JSON example, setter).
- [X] **T025** [P] Update `docs/maintenance.md` and `README.md` where they say the version comes from
  a tag on `master`.
- [X] **T026** [P] Add the `## [Unreleased]` entry to `CHANGELOG.md`.
- [X] **T027** [P] Record the feature in `AGENTS.md` (Active Technologies / Recent Changes).

## Phase 7 — Gate

- [X] **T028** `npm test && npm run lint` (read the real lint gate with `rtk proxy npm run lint`).
- [X] **T029** End-to-end smoke: build, then run the real command with `--dry-run` against throwaway
  repositories in both clone shapes (full clone and `--single-branch --branch develop`).
