# Spec Decisions: conductor --check and --dry-run

**Branch**: `feature/123-conductor-check-dry-run`
**Date**: 2026-10-05
**Spec**: specs/123-conductor-check-dry-run/spec.md
**Plan**: specs/123-conductor-check-dry-run/plan.md
**Research**: specs/123-conductor-check-dry-run/research.md

## Planning Decisions

- **Report**: a separate conductor module. **Rationale**: the `do-work` section ids do not fit. **Alternatives considered**: widen `SectionId`.
- **Dry run**: no comment permission, final message captured. **Rationale**: it cannot post by mistake. **Alternatives considered**: a scratch target; a stubbed `gh`.
- **Lock**: `inspectRunLock` takes a file name. **Rationale**: one classification for both locks. **Alternatives considered**: a copy.
