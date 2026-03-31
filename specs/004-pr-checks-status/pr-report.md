# PR Report: PR Checks Status

**Branch**: `004-pr-checks-status`
**Date**: 2026-03-30
**Spec**: [specs/004-pr-checks-status/spec.md](spec.md)

## Summary

This feature extends the `automata git get-pr-info` command to fetch and display all CI/CD status checks on the pull request. Each check is shown with a symbol indicator (✓ pass, ✗ fail, ● pending, ○ skipped), and failed checks include their failure description inline. The `--json` output is extended with a `checks` array for scripting and tooling.

## What's New

- **`src/git/gitService.ts` — PrCheck interface and extended getPrInfo**: Added a `PrCheck` interface (name, status, conclusion, description, detailsUrl) and extended `PrInfo` with a `checks` field. `getPrInfo` now requests `statusCheckRollup` from `gh pr view --json` in the same subprocess call and maps the result to `PrCheck[]`.
- **`src/commands/git.ts` — Check rendering**: Added a `formatChecks` helper that renders the checks list with UTF-8 symbol prefixes and failure details. The `get-pr-info` human-readable output now appends a `Checks:` section after the existing PR metadata.
- **`tests/unit/` — Unit test coverage**: Updated existing tests to account for the new `checks` field and added 7 new test cases covering all check states, failure details, and JSON output.

## Testing

- **Unit (mocked subprocess)**: All 70 tests pass. New tests cover: empty check list ("Checks: none"), passing check (✓), failing check with description (✗ + Details), failing check without description ("(no details available)"), in-progress check (●), and JSON output shape with `checks` array.
