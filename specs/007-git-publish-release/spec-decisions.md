# Spec Decisions: Git Publish Release

**Branch**: `007-git-publish-release`
**Date**: 2026-03-31
**Spec**: [specs/007-git-publish-release/spec.md](./spec.md)
**Plan**: [specs/007-git-publish-release/plan.md](./plan.md)
**Research**: [specs/007-git-publish-release/research.md](./research.md)

## Planning Decisions

- **Tag detection**: Chose `git describe --tags --abbrev=0 master` to find the latest semver tag on `master`. **Rationale**: Single fast command, returns tag without commit suffix, filters to `master` ancestry. **Alternatives considered**: `git tag --list --sort=-v:refname` (not restricted to master ancestry), `git log --simplify-by-decoration` (complex parsing).

- **Version increment rule**: Chose to increment the minor segment (`Y` in `X.Y.Z`) and reset patch to `0`. **Rationale**: The feature description explicitly says "increment the middle number". **Alternatives considered**: None — requirement is unambiguous.

- **Module placement**: Chose to add functions to existing `src/git/gitService.ts` and `src/commands/git.ts`. **Rationale**: Mirrors the established pattern for all git commands; no new files needed for a small, cohesive feature. **Alternatives considered**: New `src/git/releaseService.ts` file (unnecessary split, rejected per Constitution V Simplicity).

- **Dry-run strategy**: Chose to pass `dryRun: boolean` into the service function. **Rationale**: Allows full command preview with a single execution path; no duplicated logic. **Alternatives considered**: Separate `previewRelease` function (duplicates sequence logic — rejected).

- **Tag format**: Chose bare semver (`1.2.0`) without `v` prefix. **Rationale**: Matches existing tags in the repo as implied by "get the actual tag on master". Tag detection auto-strips a `v` prefix if present. **Alternatives considered**: Always `v`-prefixed (not specified and may differ from existing repo convention).

- **Merge strategy**: Chose `--no-ff` for both master and develop merges. **Rationale**: Standard GitFlow practice; preserves the branch topology for history clarity. **Alternatives considered**: Fast-forward (loses merge commit, not GitFlow compliant).
