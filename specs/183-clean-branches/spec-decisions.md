# Spec Decisions: clean-branches command

**Branch**: `feature/183-clean-branches`
**Date**: 2026-11-07
**Spec**: specs/183-clean-branches/spec.md
**Plan**: specs/183-clean-branches/plan.md
**Research**: specs/183-clean-branches/research.md

## Planning Decisions

- **Remote list**: `git ls-remote` through `listRemoteBranches()`. **Rationale**: `null` keeps "unknown" apart from "no branches", so an unreachable remote deletes nothing. **Alternatives considered**: `refs/remotes/origin/*`, stale if the fetch is skipped.
- **Pure plan, then execute**: build the plan as data, print it, confirm once, execute. **Rationale**: `--dry-run`, the prompt and the tests share one plan, as `planRelease()` does. **Alternatives considered**: delete while iterating.
- **Same-repo pull requests only**: query `isCrossRepository` and drop fork pull requests. **Rationale**: `gh pr list --head` matches the name only. **Alternatives considered**: reuse `listPullRequestsForHead`, which has no fork field.
- **Lookup failure**: keep the branch and exit 1. **Rationale**: an unauthenticated `gh` must not look like a clean run. **Alternatives considered**: skip silently.
