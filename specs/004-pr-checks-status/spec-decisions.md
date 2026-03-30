# Spec Decisions: PR Checks Status

**Branch**: `004-pr-checks-status`
**Date**: 2026-03-30
**Spec**: [specs/004-pr-checks-status/spec.md](spec.md)
**Plan**: [specs/004-pr-checks-status/plan.md](plan.md)
**Research**: [specs/004-pr-checks-status/research.md](research.md)

## Planning Decisions

- **Check data source**: Use `statusCheckRollup` added to the existing `gh pr view --json` field list. **Rationale**: Avoids a second subprocess; consistent with the existing `getPrInfo` pattern; provides structured JSON without text parsing. **Alternatives considered**: `gh pr checks` (separate subprocess, text output requiring parsing) — rejected.

- **Type extension strategy**: Add `PrCheck` as a new interface and extend `PrInfo` with `checks?: PrCheck[]` optional field. **Rationale**: Optional field is the simplest non-breaking extension; existing callers (`finish-feature`) are unaffected. **Alternatives considered**: Separate `getPrChecks` function — rejected because it duplicates subprocess + branch-resolution logic.

- **Human-readable rendering**: Symbol prefix per check (✓/✗/●/○) followed by failure `description` on an indented line for failed checks. **Rationale**: Compact, scannable, no alignment complexity. **Alternatives considered**: Tabular format — rejected for terminal width fragility and over-engineering for a short list.

- **Project structure**: No new files — extend existing `src/git/gitService.ts` and `src/commands/git.ts`. **Rationale**: Simplicity principle; the change is a targeted enhancement, not a new module.
