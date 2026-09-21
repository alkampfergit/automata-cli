# PR Report: Blocked-exit diagnostics for `do-work`

**Branch**: `feature/038-blocked-diagnostics`
**Date**: 2026-09-21
**Spec**: [specs/038-blocked-diagnostics/spec.md](../../specs/038-blocked-diagnostics/spec.md)

## Summary

A `do-work` tick that does nothing now says why. The five ways a tick can be blocked — a held run lock, an
unusable configuration, a pre-flight that did not prepare the checkout, no candidate picked up, and every
selected item skipped — each render the same six-section health report `--check` builds, headed by what
blocked them. The report itself gains the facts that would have closed issue #82 on its own: where the
operation log directory is and how that path was derived, whether it is writable, which working directory the
lock's holder runs from, and what the live tick is doing right now.

## What's New

[filled in Phase 7]

## Testing

[filled in Phase 7]
