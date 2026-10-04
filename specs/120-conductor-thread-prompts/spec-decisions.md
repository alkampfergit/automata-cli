# Spec Decisions: conductor thread assembly and prompts

**Branch**: `feature/120-conductor-thread-prompts`
**Date**: 2026-10-04
**Spec**: specs/120-conductor-thread-prompts/spec.md
**Plan**: specs/120-conductor-thread-prompts/plan.md
**Research**: specs/120-conductor-thread-prompts/research.md

## Planning Decisions

- **Layout**: frame first, then context. **Rationale**: the same as `workPrompt.ts`. **Alternatives considered**: a template with placeholders.
- **Filtering**: reuse `analyzeSurface` and `formatMessages`. **Rationale**: one rule for who may be read. **Alternatives considered**: a new filter.
- **CI status**: a separate `getPrChecks`. **Rationale**: `getPrSurface` stays unchanged for `do-work`. **Alternatives considered**: add checks to `PrSurface`.
