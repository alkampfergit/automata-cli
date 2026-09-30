# Feature Specification: Azure DevOps PR checks and branch argument

**Branch**: `feature/091-azdo-pr-checks` | **Issue**: #91 (part of #89)

## User Story 1 — Real checks in azdo mode (P1)
`automata git get-pr-info` (and `--json`) lists the checks Azure DevOps reports for the PR, rendered with the same
✓ ✗ ● ○ symbols, `Checks Running`, `Check Errors` and exit codes as GitHub mode.

## User Story 2 — Branch argument (P1)
`get-pr-info` finds the PR of the branch it is given, not only the checked-out one.

## User Story 3 — SonarCloud (P2)
A check whose `targetUrl` is on SonarCloud feeds the existing Sonar enrichment.

## Requirements
- FR-001 Map azdo check states onto `PrCheck`: `succeeded`→COMPLETED/SUCCESS; `failed`, `rejected`, `error`→COMPLETED/FAILURE;
  `notApplicable`, `notSet`→COMPLETED/SKIPPED; `pending`, `running`, `queued` and unknown→ not completed (●).
- FR-002 Current branch: `azdo pr status --json` (carries `checks[]`). Other branch: `azdo pr list --branch <b> --status all --json`
  for the PR, then `azdo pipeline get-runs --pr <id> --json` for its build runs.
- FR-003 Sonar detection reuses `describeSonarCheck`; no second Sonar path.
- FR-004 `docs/git.md` documents the state mapping; CHANGELOG bullet under Unreleased.
- FR-005 Tests use recorded-shape `azdo` JSON fixtures, no network.

## Assumptions
- [AUTO] Branch path: `azdo pr status` only supports the checked-out branch and `pr list` returns no checks, so other
  branches get build runs from `pipeline get-runs --pr` (azdo-cli 0.20.0 has no per-PR check command).
- [AUTO] Fixtures are hand-written from azdo-cli 0.20.0's documented output shapes (read from its source); no live tenant is available.
- [AUTO] A `pr list` match may be completed/abandoned; the first (newest) is used.
- [AUTO] `isBlocking: false` checks are still listed (azdo marks them `[optional]`); `description` carries azdo's detail text.
- [AUTO] The "branch argument" is `getPrInfo(branch)`; `get-pr-info` has no positional argument and none is added (out of scope).
