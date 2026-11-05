# Feature Specification: zero Sonar findings in develop

**Branch**: `feature/181-sonar-shell-findings` | **Issue**: #181

## User Story

As the maintainer, I want `npm run sonar:local` to find every finding that SonarCloud reports, so I can reach zero
findings before I push.

## Requirements

- FR-1: Compare the open SonarCloud findings of `develop` with the result of `npm run sonar:local`.
- FR-2: Extend `sonar:local` with the rules that it did not cover (the shell rules).
- FR-3: Fix the findings that the extended check reports.
- FR-4: The commit rule "run `npm run sonar:local` before each commit" is in `AGENTS.md`; keep it.

## Findings

SonarCloud reports 123 open findings on `develop` (the issue text says 38). All of them are in
`.specify/scripts/bash/common.sh` and `create-new-feature.sh`. The previous `sonar:local` found none, because it ran
SonarJS on `src/` only.

## Assumptions

- [AUTO] The check is a line-based script, not a shell parser: it matches the baseline exactly (123 of 123).
- [AUTO] The shell fixes keep behaviour: `[` to `[[`, `*) ;;` default branches, merged `if` statements.
