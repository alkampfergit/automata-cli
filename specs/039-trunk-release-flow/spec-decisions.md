# Spec Decisions: Trunk-based release flow

**Branch**: `feature/039-trunk-release-flow`
**Date**: 2026-09-26
**Spec**: [specs/039-trunk-release-flow/spec.md](specs/039-trunk-release-flow/spec.md)
**Plan**: [specs/039-trunk-release-flow/plan.md](specs/039-trunk-release-flow/plan.md)
**Research**: [specs/039-trunk-release-flow/research.md](specs/039-trunk-release-flow/research.md)

## Planning Decisions

- **Flow detection**: `git ls-remote --exit-code --heads origin develop`. Exit 0 means gitflow, exit 2 means trunk,
  and any other exit refuses with git's stderr. **Rationale**: it asks the remote directly, so it also works in a
  `--single-branch` clone, and a network failure cannot silently switch the release procedure. **Alternatives
  considered**: reusing `remoteBranchExists()`, which reads every failure as absent; checking the local
  `refs/remotes/origin/develop`, which does not exist in a single-branch clone; inferring the flow from the current
  branch.
- **Empty release commit on every trunk release**: `git commit --allow-empty -m "chore(release): <version>"`.
  **Rationale**: the branch-push CI fires only when the trunk ref moves; GitFlow's `merge --no-ff` guarantees that, and
  the empty commit does the same for the trunk flow. **Alternatives considered**: requiring the trunk to be ahead of
  `origin`, and a tag-only push with a tag-triggered CI. Both were rejected on issue #84.
- **Atomic push**: `git push --atomic origin <trunk> <version>`. **Rationale**: CI reads the tag on `HEAD` of the
  branch-push checkout, so the tag must land with the branch. `--atomic` also rules out a published tag whose branch
  was rejected; the probe confirmed that both refs are rejected together. **Alternatives considered**: two separate
  pushes, which reintroduce the "No version tag found on HEAD" race.
- **Release plan as pure data**: `planRelease(flow, version, trunk, trunkIsLocal)` goes in a new
  `src/git/releaseFlow.ts`, and `publishRelease()` only runs the steps. **Rationale**: two flows means two step lists,
  which can be tested without mocking `spawnSync`, and the dry run and the real run share the same list.
  **Alternatives considered**: branching inside `publishRelease()`.
- **Order of checks**: resolve the trunk, then the flow, then the branch and clean-tree preconditions, with the expected
  branch passed in. **Rationale**: the trunk flow's branch check needs the trunk name. **Alternatives considered**:
  keeping the `develop` check first, which refuses every trunk-flow run.
- **Structure**: the pure module sits beside `gitService.ts`, which keeps the `spawnSync` runner. This follows the 036
  `trunkDetection.ts` precedent.
