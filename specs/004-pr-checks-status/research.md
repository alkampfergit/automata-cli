# Research: PR Checks Status

**Branch**: `004-pr-checks-status`
**Date**: 2026-03-30

## Findings

### gh CLI `statusCheckRollup` field

`gh pr view <branch> --json statusCheckRollup` returns a JSON array of check objects. Each object has:

```json
{
  "name": "build",
  "status": "COMPLETED",
  "conclusion": "SUCCESS",
  "description": "",
  "detailsUrl": "https://..."
}
```

Key fields:
- `name` — human-readable check name
- `status` — `QUEUED | IN_PROGRESS | COMPLETED`
- `conclusion` — `SUCCESS | FAILURE | CANCELLED | SKIPPED | NEUTRAL | TIMED_OUT | ACTION_REQUIRED | null`
- `description` — short description / failure message (may be empty)
- `detailsUrl` — link to full logs (useful for JSON output but not rendered in human mode)

**Decision**: Extend the existing `gh pr view --json` call to add `statusCheckRollup` to the requested fields (comma-separated list). This avoids any additional subprocess and keeps the implementation consistent with the current pattern.

**Rationale**: Minimal change; no new dependencies; consistent with existing code.

**Alternatives considered**: Running `gh pr checks` as a separate call — rejected because it starts an extra subprocess and produces text output requiring parsing, whereas `--json statusCheckRollup` gives a structured array.

### Backward compatibility

The existing `PrInfo` type (`number`, `title`, `state`, `url`) is used by `finish-feature`. Adding `checks` as an optional field (`checks?: PrCheck[]`) keeps the existing callers unaffected.

**Decision**: Add `checks` as an optional field on `PrInfo`; populate it in `getPrInfo`.

**Rationale**: Optional field is the simplest non-breaking extension.

**Alternatives considered**: A separate `getPrChecks` function — rejected because it would require a second `gh` invocation (slower) and duplicate the branch-resolution logic.

### Human-readable rendering

**Decision**: Render checks beneath the existing PR metadata lines, prefixed with symbols: `✓` (SUCCESS), `✗` (FAILURE/TIMED_OUT/ACTION_REQUIRED/CANCELLED), `●` (QUEUED/IN_PROGRESS), `○` (SKIPPED/NEUTRAL). For failed checks, print the `description` on the next indented line; if empty, print `(no details available)`.

**Rationale**: Symbol approach is compact, instantly scannable, and avoids table alignment complexity.

**Alternatives considered**: Tabular format — rejected as overly complex for a terminal with variable-length check names.

## Autonomous Decisions

- [AUTO] Use `statusCheckRollup` not `checkRuns` — `statusCheckRollup` is available in `gh pr view --json` and covers both GitHub Actions and external status checks.
- [AUTO] Symbols chosen: ✓ ✗ ● ○ — universally renderable in UTF-8 terminals; widely understood.
- [AUTO] `conclusion` field drives pass/fail, not `status`, because `status=COMPLETED` with `conclusion=SUCCESS` is the success state.
