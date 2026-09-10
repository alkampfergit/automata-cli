# PR Report: Manage orphaned pull requests in `do-work`

**Branch**: `feature/033-orphan-pull-requests`
**Date**: 2026-09-10
**Spec**: [specs/033-orphan-pull-requests/spec.md](spec.md)

## Summary

`do-work` could only ever see issues: a pull request that closes no issue — a Dependabot bump, say —
was invisible to a tick, so nobody could ask the agent to rebase it, fix its CI, or say whether it
was safe to merge. This adds a second discovery pass over exactly those pull requests, selected with
the same discovery filter the issue pass uses and triggered by the same rule — an authorized account
has left a message the agent has not answered. The new `pr-orphan` turn runs on the pull request's
head branch with its own configurable prompt, shares the issue pass's run budget, and reuses the
existing fork and protected-branch refusals.

## What's New

- [To be completed in Phase 7]

## Testing

- [To be completed in Phase 7]
