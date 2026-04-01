# PR Report: Sonar Failure Details in get-pr-info

**Branch**: `012-sonar-failure-details`
**Date**: 2026-04-01
**Spec**: [specs/012-sonar-failure-details/spec.md](spec.md)

## Summary

This feature expands `automata git get-pr-info` so a failing SonarCloud check can include actionable failure details directly in the command output. For public SonarCloud projects, the command will surface both quality gate violations and pull-request issue details; for private projects, it will explain that authenticated browser access is required.

## What's New

- **`get-pr-info` Sonar enrichment**: Failing SonarCloud checks now attach structured `sonarFailures` data to the PR result, including quality gate violations, issue details, and quality gate status when the public API is accessible.
- **Private-project handling**: When SonarCloud returns HTTP 401, `get-pr-info` now reports that the Sonar project is private and directs the user to open the existing Sonar URL in an authenticated browser instead of returning an ambiguous missing value.
- **CLI output and docs**: Human-readable output now includes a dedicated `Sonar Failures:` section, and `docs/git.md` documents both the new section and the extended JSON payload.

## Testing

- **Unit**: Added coverage in `tests/unit/git.commands.test.ts` for public failing Sonar checks, private-project 401 handling, structured `--json` output, and regression coverage around check-run URL enrichment.
- **Repo validation**: Ran `npm test && npm run lint`.
