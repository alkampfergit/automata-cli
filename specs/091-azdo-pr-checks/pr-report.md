# Azure DevOps PR checks and branch argument

**Branch**: `feature/091-azdo-pr-checks` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

## Summary
In Azure DevOps mode `automata git get-pr-info` now shows the pull request's real checks, rendered and exit-coded
exactly like GitHub mode. `getPrInfo(branch)` also honours a branch other than the checked-out one, and a SonarCloud
check gets the existing Sonar enrichment.

## What's New
- `src/config/azdoService.ts`: `mapCheckState` onto the GitHub status/conclusion vocabulary; `getPrInfo(branch?)` reads `checks[]` from `azdo pr status`, or `pr list --branch` + `pipeline get-runs --pr` for another branch.
- `src/git/gitService.ts`: the Sonar step is extracted (`withSonar`) and shared by GitHub and Azure DevOps.
- `docs/git.md`: Azure DevOps mode section with the state mapping table; `docs/azdo-gap.md` row; CHANGELOG bullet.

## Testing
Unit tests with `azdo` JSON fixtures (`tests/fixtures/azdo/`): state mapping, status path, other-branch path, routing in `gitService`. `npm test` (1545) and `npm run lint` green.

## Notes
- Fixtures are hand-written from azdo-cli 0.20.0's output shapes; no live tenant was available.
- For another branch, policy/status checks are unavailable in azdo-cli 0.20.0, so build runs are shown instead.
- `get-pr-info` has no positional branch argument; none was added.

Closes #91
