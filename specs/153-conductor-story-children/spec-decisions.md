# Spec Decisions: Conductor story children

**Branch**: `feature/153-conductor-story-children`
**Date**: 2026-10-17
**Spec**: specs/153-conductor-story-children/spec.md
**Plan**: specs/153-conductor-story-children/plan.md
**Research**: specs/153-conductor-story-children/research.md

## Planning Decisions

- **Storage**: a `stories` list in the watch file. **Rationale**: a story needs no reply logic and must not be pruned as an item. **Alternatives considered**: the parent in `watch` with a flag.
- **Children**: read at each tick, never stored. **Rationale**: no stale copy. **Alternatives considered**: store them at `add`.
- **Order**: the first open child decides; a blocked child stops the story. **Rationale**: strict order, as the issue asks. **Alternatives considered**: skip a blocked child.
- **Pure module**: `src/conductor/story.ts`. **Rationale**: testable with no `gh`. **Alternatives considered**: inline logic in `conductor.ts`.
- **Close**: `gh issue close --comment`. **Rationale**: one call, so a failed close cannot repeat the comment. **Alternatives considered**: comment, then close.
