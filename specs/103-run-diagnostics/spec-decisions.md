# Spec Decisions: Run diagnostics when the agent posts no answer

**Branch**: `feature/103-run-diagnostics`
**Date**: 2026-09-30
**Spec**: specs/103-run-diagnostics/spec.md
**Plan**: specs/103-run-diagnostics/plan.md
**Research**: specs/103-run-diagnostics/research.md

## Planning Decisions

- **Transcript location**: `.automata/runs/` with a self-ignoring `.gitignore`. **Rationale**: agreed in the issue; never dirties the tree. **Alternatives considered**: operation-log directory; `AUTOMATA_OWN_PATHS`.
- **Excerpt source**: readable lines, not raw `stream-json`. **Rationale**: legible in a comment. **Alternatives considered**: raw tail.
- **stderr**: piped and forwarded. **Rationale**: the transcript needs it. **Alternatives considered**: leave inherited.
