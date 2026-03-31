# Data Model: PR Checks Status

**Branch**: `004-pr-checks-status`
**Date**: 2026-03-30

## Entities

### PrCheck

Represents a single CI/CD status check on a pull request.

| Field       | Type   | Description                                                              |
|-------------|--------|--------------------------------------------------------------------------|
| name        | string | Human-readable check name (e.g., "build", "lint")                       |
| status      | string | Lifecycle status: QUEUED \| IN_PROGRESS \| COMPLETED                    |
| conclusion  | string \| null | Outcome: SUCCESS \| FAILURE \| CANCELLED \| SKIPPED \| NEUTRAL \| TIMED_OUT \| ACTION_REQUIRED \| null |
| description | string | Short failure detail text; empty string when not applicable              |
| detailsUrl  | string | URL to full check run logs (included in JSON output)                     |

### PrInfo (extended)

The existing `PrInfo` interface gains an optional `checks` field:

| Field   | Type       | Description                                    |
|---------|------------|------------------------------------------------|
| number  | number     | PR number                                      |
| title   | string     | PR title                                       |
| state   | string     | PR state (OPEN / MERGED / CLOSED)              |
| url     | string     | PR URL                                         |
| checks  | PrCheck[]  | Status checks; populated by `getPrInfo`; optional (absent when no checks exist) |

## State Transitions

A check progresses: `QUEUED → IN_PROGRESS → COMPLETED`

When `COMPLETED`, the `conclusion` field determines pass/fail rendering:
- **Pass** → `SUCCESS`
- **Skip** → `SKIPPED | NEUTRAL`
- **Fail** → `FAILURE | TIMED_OUT | ACTION_REQUIRED | CANCELLED`
- **Pending** → `QUEUED | IN_PROGRESS` (conclusion is null)
