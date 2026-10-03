# Spec Decisions: Azure DevOps unresolved PR threads

**Branch**: `feature/092-azdo-pr-comments`
**Date**: 2026-10-03
**Spec**: specs/092-azdo-pr-comments/spec.md
**Plan**: specs/092-azdo-pr-comments/plan.md
**Research**: specs/092-azdo-pr-comments/research.md

## Planning Decisions

- **PR lookup**: `pr list --branch` then `pr comments --pr-number`. **Rationale**: no PR yields `null` and the existing error. **Alternatives considered**: azdo auto-detection.
- **Local status filter**: assert `active`/`pending` in automata as well as via azdo flags. **Rationale**: keeps the contract tested. **Alternatives considered**: trust the flags alone.
- **General threads**: excluded. **Rationale**: GitHub threads are always file-anchored and `path` is required. **Alternatives considered**: include with an empty path.
