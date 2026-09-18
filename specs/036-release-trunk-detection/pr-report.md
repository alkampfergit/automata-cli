# PR Report: Release Trunk Detection

**Branch**: `feature/036-release-trunk-detection`
**Date**: 2026-09-18
**Spec**: [specs/036-release-trunk-detection/spec.md](spec.md)

## Summary

`automata git publish-release` assumed the trunk branch is called `master` and that it exists
locally, so on a clone that only checked out `develop` it stopped with "No semver tag found on
master" — and it failed for a second reason on any repository whose trunk is `main`. This change
resolves the trunk name from the remote (with an optional config override), fetches tags and the
trunk ref before inferring a version, and threads the resolved name through every step of the
release sequence.

## What's New

*(completed in Phase 7)*

## Testing

*(completed in Phase 7)*
