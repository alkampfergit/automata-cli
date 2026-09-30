# Spec Decisions: Harden the issue-to-PR link repair

**Branch**: `feature/102-harden-pr-issue-link`
**Date**: 2026-09-30
**Spec**: specs/102-harden-pr-issue-link/spec.md
**Plan**: specs/102-harden-pr-issue-link/plan.md
**Research**: specs/102-harden-pr-issue-link/research.md

## Planning Decisions

- **Lookup by head**: `gh pr list --head`. **Rationale**: independent of checkout, shows all bases. **Alternatives considered**: `gh pr view <branch>`, `getCurrentBranchPr`.
- **Branch discovery**: end branch plus branches new since a pre-run snapshot, minus base. **Rationale**: no network, cannot reach a release PR. **Alternatives considered**: author/assignee search, branch-name pattern.
- **One reference check**: shared `hasClosingRef`. **Rationale**: the two checks disagreed. **Alternatives considered**: leave both.
