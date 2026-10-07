# Spec Decisions: Azure DevOps PR / work item write adapter

**Branch**: `feature/093-azdo-write-adapter`
**Date**: 2026-10-03
**Spec**: specs/093-azdo-write-adapter/spec.md
**Plan**: specs/093-azdo-write-adapter/plan.md
**Research**: specs/093-azdo-write-adapter/research.md

## Planning Decisions

- **PR claim is a no-op**. **Rationale**: Azure DevOps has no PR assignee. **Alternatives considered**: add the agent as reviewer (votes on its own work); throw (breaks best-effort callers).
- **Work-item comment body in argv**. **Rationale**: `azdo comments add` has no stdin/file form in 0.20.0; no shell, so no quoting risk. **Alternatives considered**: a markdown field write (overwrites); skip (blocks the feature).
- **Interface plus GitHub wrapper in one seam**. **Rationale**: same signatures as the gh callers, selected through the foundation. **Alternatives considered**: azdo module only (nothing would select it).
