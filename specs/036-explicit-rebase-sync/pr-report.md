# PR Report: Explicit branch-synchronisation strategy for `do-work`

**Branch**: `feature/036-explicit-rebase-sync`
**Date**: 2026-09-16
**Spec**: [specs/036-explicit-rebase-sync/spec.md](spec.md)

## Summary

`automata do-work` could be permanently unable to process a pull request whose local branch had diverged from its
remote, even when both tips carried identical content: the pull is `--ff-only` and the only recovery covered a force
push, so an equivalent divergence was skipped as `pull-failed` on every tick forever. This branch adds a third,
explicitly-named recovery — rebase onto the remote, but only when every local-only commit is provably already applied
upstream — and refuses everything else without moving a ref. It also refreshes the npm dependency references so a
release can be cut.

## What's New

[Completed in Phase 7]

## Testing

[Completed in Phase 7]

## Notes

[Completed in Phase 7]
