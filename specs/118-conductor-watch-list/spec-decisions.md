# Spec Decisions: conductor watch list

**Branch**: `feature/118-conductor-watch-list`
**Date**: 2026-10-02
**Spec**: specs/118-conductor-watch-list/spec.md
**Plan**: specs/118-conductor-watch-list/plan.md
**Research**: specs/118-conductor-watch-list/research.md

## Planning Decisions

- **Resolution**: one REST call per id. **Rationale**: distinguishes issue/PR and state at once. **Alternatives considered**: `gh issue view` with PR fallback.
- **Linked PRs**: reuse `getOpenPrLinkMap`. **Rationale**: the authoritative closing-reference map. **Alternatives considered**: new timeline query.
- **Discovery**: `gh issue|pr edit`. **Rationale**: same mechanism as the agent assignment helpers. **Alternatives considered**: REST label endpoints.
- **Pruning errors**: keep the id on lookup failure. **Rationale**: a network error must not empty the list. **Alternatives considered**: drop unknown ids.
