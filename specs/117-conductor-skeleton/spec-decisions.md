# Spec Decisions: `automata conductor` skeleton

**Branch**: `feature/117-conductor-skeleton`
**Date**: 2026-10-02
**Spec**: specs/117-conductor-skeleton/spec.md
**Plan**: specs/117-conductor-skeleton/plan.md
**Research**: specs/117-conductor-skeleton/research.md

## Planning Decisions

- **Lock**: reuse `acquireRunLock` with a lock-file parameter. **Rationale**: audited atomic primitive. **Alternatives considered**: copy the module.
- **Own paths**: add the lock to `AUTOMATA_OWN_PATHS`. **Rationale**: avoids `dirty-tree` skips in `do-work`. **Alternatives considered**: separate constant.
- **Identity**: fail when `gh` identity is unverifiable. **Rationale**: the role must prove it is an allowed human. **Alternatives considered**: warn like `do-work`.
