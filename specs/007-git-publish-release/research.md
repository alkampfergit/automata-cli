# Research: Git Publish Release

**Branch**: `007-git-publish-release` | **Date**: 2026-03-31

## Phase 0: Research

### Decision: How to detect the latest semver tag on master

- **Decision**: Run `git describe --tags --abbrev=0 master` to get the most recent tag reachable from `master`, then validate it matches `X.Y.Z` semver with a regex.
- **Rationale**: `git describe --tags --abbrev=0 master` returns the most recent tag reachable from `master` without a commit suffix, which is exactly the latest release tag. This is a single, fast git command.
- **Alternatives considered**: `git tag --list --sort=-v:refname` (lists all tags sorted by version, but not filtered to master ancestry — could pick up tags on other branches); `git log master --simplify-by-decoration` (more complex parsing).

### Decision: How to increment the minor version

- **Decision**: Parse the tag as three integers `[major, minor, patch]`, increment `minor` by 1, reset `patch` to 0, reassemble as `major.minor+1.0`.
- **Rationale**: The user description says "increment the middle number", which is unambiguously the minor segment in semver `X.Y.Z`.
- **Alternatives considered**: None — the requirement is explicit.

### Decision: Where to add the publish-release git operations

- **Decision**: Add new exported functions `getLatestTagOnMaster`, `bumpMinorVersion`, `createReleaseBranch`, `mergeAndTag`, and `pushRelease` to `src/git/gitService.ts`. Add `publishReleaseCmd` command in `src/commands/git.ts`.
- **Rationale**: Mirrors the exact pattern used by all other git commands: service logic in `gitService.ts`, commander wiring in `git.ts`. This keeps the service layer testable by module mocking.
- **Alternatives considered**: New file `src/git/releaseService.ts` (unnecessary split for a small, cohesive feature — rejected per Constitution V Simplicity).

### Decision: --dry-run implementation approach

- **Decision**: Pass a `dryRun: boolean` flag through to the service functions. When `true`, each function logs the git command it would run to stdout and returns immediately without executing.
- **Rationale**: Consistent with common CLI conventions; allows full command preview without any side effects.
- **Alternatives considered**: Separate `previewRelease` function (duplicates the sequence logic — rejected).

### Decision: Tag format (bare vs. prefixed)

- **Decision**: Use bare semver tags (`1.2.0`) without a `v` prefix, matching the existing tags in this repository.
- **Rationale**: [AUTO] The spec says "get the actual tag on master and increment the middle number" — this implies bare semver tags. We always create bare tags (e.g. `git tag 1.3.0`); v-prefixed input tags are stripped for version arithmetic but the output tag is never re-prefixed.
- **Alternatives considered**: Always `v`-prefixed (common but not specified and may break tag detection logic).

## Autonomous Decisions

- [AUTO] `git tag` message: using a lightweight (non-annotated) tag because the feature description says "simulate" and annotated tags require a message, adding unnecessary complexity. This can be changed if the user prefers annotated tags.
- [AUTO] Merge message: using default git merge commit messages (no `--message` override).
- [AUTO] Abort on conflict: if any merge produces a conflict, the command aborts with an error. No auto-resolution attempted.
