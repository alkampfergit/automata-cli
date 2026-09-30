# Feature Specification: Harden the issue-to-PR link repair

**Branch**: `feature/102-harden-pr-issue-link` | **Issue**: #102 | **Created**: 2026-09-30

## Problem
The closing reference (`Closes #N`) is `do-work`'s state machine. Its post-turn repair only ran after `issue-discuss`
turns, and looked the pull request up through the *checked-out* branch, so a pull request opened from a branch the model
then left, or a reference dropped during a `pr-work` turn, stayed unlinked and the issue looked stuck.

## Requirements
- FR-1: The pull request is found by head branch (`gh pr list --head`), not by the current checkout.
- FR-2: Repair runs after every turn that has an issue (`issue-discuss`, `pr-work`); `pr-orphan` has none.
- FR-3: After a discuss turn the candidates are the branch it ended on plus local branches created during it; never the base branch.
- FR-4: `Fixes`/`Resolves` count as references; `Closes #420` does not satisfy `#42`.
- FR-5: Any `gh` failure stays a warning; the turn outcome is unchanged (except the existing "opened a PR counts as answered").

## Assumptions
- [AUTO] Discovering unknown branches: chose "new local branches since before the run" because it needs no remote query and cannot reach a pre-existing (release) branch.
- [AUTO] Several PRs on one head: chose the one aimed at the base branch, else refuse to guess when ambiguous.
- [AUTO] `pr-orphan` is out of scope: it has no issue to link to.
