# Spec Decisions: conductor reply decision

**Branch**: `feature/119-conductor-reply-decision`
**Date**: 2026-10-03
**Spec**: specs/119-conductor-reply-decision/spec.md
**Plan**: specs/119-conductor-reply-decision/plan.md
**Research**: specs/119-conductor-reply-decision/research.md

## Planning Decisions

- **Reuse**: `agentAnsweredAfter` per allowed user. **Rationale**: the same "answered after" test `do-work` owns. **Alternatives considered**: `decideWork` with swapped participants; a new comparison.
- **Shape**: one `Conversation` for issue and PR. **Rationale**: one rule, no per-kind branches. **Alternatives considered**: separate functions.
