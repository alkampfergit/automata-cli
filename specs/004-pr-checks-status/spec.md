# Feature Specification: PR Checks Status

**Feature Branch**: `004-pr-checks-status`
**Created**: 2026-03-30
**Status**: Draft
**Input**: User description: "list all CI/CD checks in get-pr-info output with pass/fail status, and show failure details for failed checks"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View All Checks with Pass/Fail Status (Priority: P1)

As a developer running `automata git get-pr-info`, I want to see all CI/CD checks associated with my pull request along with a clear pass or fail indicator, so I can immediately know the overall health of my PR without visiting GitHub.

**Why this priority**: The core value is the pass/fail overview. Without this, the user cannot tell whether CI is green or red from the CLI.

**Independent Test**: Run `automata git get-pr-info` on a branch that has a PR with checks; the output should list each check by name and status.

**Acceptance Scenarios**:

1. **Given** a branch with a PR that has passing checks, **When** I run `automata git get-pr-info`, **Then** each check is listed with a clear "passed" indicator.
2. **Given** a branch with a PR that has a mix of passing and failing checks, **When** I run `automata git get-pr-info`, **Then** each check shows its individual status (passed/failed/pending).
3. **Given** a branch with a PR that has no checks, **When** I run `automata git get-pr-info`, **Then** the output notes that no checks are present.

---

### User Story 2 - View Failure Details for Failed Checks (Priority: P2)

As a developer, when a check has failed I want to see the failure details (error message, summary, or log excerpt) inline in the output, so I can diagnose the problem without leaving the terminal.

**Why this priority**: Knowing a check failed is only half the value; the actionable insight is the failure reason.

**Independent Test**: Run `automata git get-pr-info` on a branch with a failed check; the output should include the failure details directly below the failed check entry.

**Acceptance Scenarios**:

1. **Given** a PR with one or more failed checks, **When** I run `automata git get-pr-info`, **Then** each failed check shows its conclusion message or summary text immediately after the check name and status.
2. **Given** a PR where all checks pass, **When** I run `automata git get-pr-info`, **Then** no failure details section is shown (output stays concise).
3. **Given** a PR with a failed check that has no detail text available, **When** I run `automata git get-pr-info`, **Then** the failed check is still listed with its status and a note that no detail is available.

---

### User Story 3 - JSON Output Includes Checks Data (Priority: P3)

As a developer or script author using the `--json` flag, I want the full checks data (name, status, and failure details) included in the JSON output, so I can pipe the data into other tools or parse it programmatically.

**Why this priority**: The `--json` flag is a core convention in this CLI; checks data must be machine-readable for scripting use cases.

**Independent Test**: Run `automata git get-pr-info --json` on a branch with checks; parse the JSON and verify a `checks` array is present with the expected fields.

**Acceptance Scenarios**:

1. **Given** a PR with checks, **When** I run `automata git get-pr-info --json`, **Then** the JSON output includes a `checks` array where each entry has at least `name`, `status`, and `conclusion` fields.
2. **Given** a PR with a failed check, **When** I run `automata git get-pr-info --json`, **Then** the failed check entry includes a `detailsUrl` or `description` field with the failure text.
3. **Given** a PR with no checks, **When** I run `automata git get-pr-info --json`, **Then** the `checks` array is present and empty.

---

### Edge Cases

- What happens when some checks have a "pending" or "in_progress" status? They are displayed with their actual status, not treated as failed.
- How does the system handle a PR with many checks? All checks are listed with no truncation.
- What if the GitHub API returns an error while fetching check data? The error is written to stderr and the command exits with a non-zero code.
- What if a failed check has no description text? The check is listed as failed with a note that no details are available.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `get-pr-info` command MUST display all status checks associated with the pull request in human-readable output.
- **FR-002**: Each check MUST be listed with its name and a clear pass/fail/pending indicator.
- **FR-003**: For each failed check, the command MUST display the failure details (description or summary) directly beneath the check entry in human-readable mode.
- **FR-004**: When a failed check has no detail text, the command MUST still list the check as failed and indicate that no details are available.
- **FR-005**: The `--json` flag output MUST include a `checks` array with name, status, conclusion, and description fields for each check.
- **FR-006**: When a PR has no checks, the command MUST note this explicitly in human-readable mode and return an empty `checks` array in JSON mode.
- **FR-007**: Errors from the GitHub CLI when fetching check data MUST be written to stderr and cause a non-zero exit code.

### Key Entities

- **Check**: A single CI/CD status check on the PR. Attributes: name, status (queued/in_progress/completed), conclusion (success/failure/cancelled/skipped/neutral/null), and description (failure detail text when available).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can determine whether all PR checks pass or fail from a single `automata git get-pr-info` invocation without opening a browser.
- **SC-002**: When at least one check has failed, the failure detail text is visible in the same command output, eliminating the need to navigate to GitHub Actions.
- **SC-003**: The `--json` output contains a `checks` array with the required fields for every PR queried.
- **SC-004**: PRs with no checks produce a clear, unambiguous output with no blank sections or silent omissions.

## Assumptions

- [AUTO] Check data source: use `gh pr view --json statusCheckRollup` because it is consistent with the existing `getPrInfo` pattern and avoids a second subprocess call.
- [AUTO] Detail text: use the `description` field from `statusCheckRollup` entries as failure detail text; it is available without additional API calls.
- [AUTO] Human-readable format: use symbol prefixes (✓ pass, ✗ fail, ● pending) for instant visual scan-ability; this is consistent with typical terminal CLI tools.
- [AUTO] Pending/in_progress checks: displayed with a distinct indicator (not treated as failure); this avoids false negatives during CI runs.
