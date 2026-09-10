# PR Report: `do-work` pre-flight repository hygiene

**Branch**: `feature/032-do-work-repo-hygiene`
**Date**: 2026-09-10
**Spec**: [specs/032-do-work-repo-hygiene/spec.md](../../specs/032-do-work-repo-hygiene/spec.md)

## Summary

`automata do-work` now opens every tick by putting the checkout into a known state instead of
assuming one. Uncommitted changes are committed, pushed and given a draft pull request rather
than causing every work item to skip with `dirty-tree`; the base branch is checked out and
fast-forwarded on every tick, including one with nothing to do; and local branches that exist on
no remote and have no open pull request are deleted — or pushed with a draft pull request when
they carry commits the base branch does not already have.

## What's New

[PENDING — completed in Phase 7]

## Testing

[PENDING — completed in Phase 7]
