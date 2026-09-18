# PR Report: `do-work --check` — a read-only health report for the autonomous loop

**Branch**: `feature/036-do-work-check`
**Date**: 2026-09-18
**Spec**: [specs/036-do-work-check/spec.md](./spec.md)

## Summary

`do-work` runs from a scheduler and discards its own stdout, so when the loop quietly
stops picking work up there is nowhere to look. This adds `automata do-work --check`: a
read-only report that answers, in one command, whether a tick is running, whether the
scheduler is still firing, what the last runs did, whether the checkout is in a state that
permits work, why each candidate issue is or is not being picked up, and whether the
configuration, `gh` and the executor are sound. It exits `0` when it found no problem and
`1` when it did.

## What's New

*(completed at Phase 7)*

## Testing

*(completed at Phase 7)*
