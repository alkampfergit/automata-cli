# PR Report: Git Publish Release

**Branch**: `007-git-publish-release`
**Date**: 2026-03-31
**Spec**: [specs/007-git-publish-release/spec.md](./spec.md)

## Summary

Adds `automata git publish-release [version]` — a single command that executes the complete GitFlow release lifecycle: branches from `develop`, merges into `master` with a version tag, merges back into `develop`, removes the release branch, and pushes all three refs to `origin`. When no version is supplied, the command auto-detects the latest semver tag on `master` and increments the minor segment.

## What's New

<!-- To be completed after implementation -->

- **[Area / Component]**: [What was added or changed and why]

## Testing

<!-- To be completed after implementation -->

- **[Unit / Integration / E2E / Manual]**: [What scenario or component was covered]

## Notes

<!-- To be completed after implementation -->
