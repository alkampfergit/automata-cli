# PR Report: Git Publish Release

**Branch**: `007-git-publish-release`
**Date**: 2026-03-31
**Spec**: [specs/007-git-publish-release/spec.md](./spec.md)

## Summary

Adds `automata git publish-release [version]` — a single command that executes the complete GitFlow release lifecycle: branches from `develop`, merges into `master` with a version tag, merges back into `develop`, removes the release branch, and pushes all three refs to `origin`. When no version is supplied, the command auto-detects the latest semver tag on `master` and increments the minor segment.

## What's New

- **`automata git publish-release` command**: New subcommand under `automata git` that executes the complete GitFlow release sequence (branch → merge to master → tag → merge to develop → delete release branch → push) in a single invocation.
- **Auto-versioning**: When no version argument is given, the command queries the latest semver tag on `master` and auto-increments the minor segment (e.g. `1.2.0 → 1.3.0`).
- **`--dry-run` flag**: Prints each git command that would be executed without modifying any local or remote state.
- **`src/git/gitService.ts`**: Added `getLatestTagOnMaster`, `bumpMinorVersion`, `tagExists`, and `publishRelease` service functions.
- **`docs/git.md`**: Documented the new command with arguments, options, release sequence, preconditions, and exit codes.

## Testing

- **Unit — service functions**: `bumpMinorVersion` (minor bump, patch reset, v-prefix strip, invalid input), `getLatestTagOnMaster` (happy path, v-prefix, no tags, non-semver tag), `tagExists` (present / absent), `publishRelease` (full sequence order, step failure error, dry-run no-exec).
- **Smoke — CLI help**: The existing `git.cmd.test.ts` smoke test was extended to verify `publish-release` appears in `automata git --help`.

## Notes

- The command does not update any version file (e.g. `package.json`). It is intentionally scoped to git operations only.
- Tags are lightweight (non-annotated). Annotated tags can be added as a follow-up if needed.
