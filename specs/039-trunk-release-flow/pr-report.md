# PR Report: Trunk-based release flow

**Branch**: `feature/039-trunk-release-flow`
**Date**: 2026-09-26
**Spec**: [specs/039-trunk-release-flow/spec.md](specs/039-trunk-release-flow/spec.md)

## Summary

`automata git publish-release` now releases from repositories that only have `main` or `master`, as well as from GitFlow
repositories. The flow is detected from whether `origin` has a `develop` branch, or pinned with `git.releaseFlow`. On
the trunk flow the command creates an empty release commit on the trunk, tags it, and pushes the branch and the tag in
one atomic push, so the existing branch-push CI publishes the release.

## What's New

- [TO BE COMPLETED]

## Testing

- [TO BE COMPLETED]
