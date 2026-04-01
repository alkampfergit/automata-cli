# Spec Decisions: Sonar Failure Details in get-pr-info

**Branch**: `012-sonar-failure-details`
**Date**: 2026-04-01
**Spec**: [specs/012-sonar-failure-details/spec.md](spec.md)
**Plan**: [specs/012-sonar-failure-details/plan.md](plan.md)
**Research**: [specs/012-sonar-failure-details/research.md](research.md)

## Planning Decisions

- **Sonar integration point**: Extend the existing `get-pr-info` Sonar detection path in `src/git/gitService.ts`. **Rationale**: The command already exposes Sonar metadata, so enriching that path minimizes scope and preserves current usage. **Alternatives considered**: Add a separate Sonar command; infer Sonar checks by display name only.
- **Return shape**: Add structured Sonar failure data to `PrInfo` for both human-readable and `--json` output. **Rationale**: The user wants the return value to be directly usable by Claude or Codex without scraping text. **Alternatives considered**: Collapse details into one formatted string; expose only terminal output.
- **Private-project handling**: Treat Sonar HTTP 401 as a specific private-project case and surface browser-auth guidance. **Rationale**: This matches the requested behavior and avoids ambiguous "unavailable" output. **Alternatives considered**: Return generic unavailable; fail the command.
- **Failure detail sources**: Query both Sonar quality gate status and PR-scoped issues. **Rationale**: Quality gate failures and code issues represent different parts of the requested actionable detail. **Alternatives considered**: Fetch only issues; fetch only gate status.
