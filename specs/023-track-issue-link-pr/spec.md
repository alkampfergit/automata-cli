# Feature Specification: Track Issue Context and Link PRs

**Feature Branch**: `023-track-issue-link-pr`  
**Created**: 2026-04-08  
**Status**: Draft  
**Input**: User description: "Track issue context during implement-next, link PRs to issues, and optionally request Copilot review"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Track issue and link PR comment (Priority: P1)

A developer runs `automata implement-next`. The tool posts a "working" comment on the GitHub issue. After the AI finishes and a PR is opened on the branch, the tool edits the original "working" comment to include the PR number and URL, and the PR body includes `Closes #N` so merging auto-closes the issue.

**Why this priority**: This is the core value — connecting the issue lifecycle to the PR lifecycle automatically. Without this, users must manually cross-reference issues and PRs.

**Independent Test**: Can be tested by mocking `gh` calls to verify: (1) `postComment` returns a comment ID, (2) after AI invocation, the tool checks for an open PR, (3) if found, edits the comment and adds the issue reference.

**Acceptance Scenarios**:

1. **Given** a claimed issue #42 with comment ID 12345, **When** the AI finishes and a PR #7 exists on the branch, **Then** the "working" comment is edited to include "PR: #7" and the PR body includes `Closes #42`.
2. **Given** a claimed issue #42, **When** the AI finishes and no PR exists on the branch, **Then** no comment edit occurs and the process exits normally.
3. **Given** a claimed issue #42, **When** `--no-claude` is used, **Then** Claude is skipped but post-claim PR detection still runs; if a PR already exists on the branch, the "working" comment is updated to include it and the PR body includes `Closes #42`, otherwise the comment stays as-is.

---

### User Story 2 - Request Copilot review (Priority: P2)

After the AI finishes and a PR exists on the branch, if the `--ask-copilot-review` flag is passed, the tool runs `gh pr edit --add-reviewer @copilot` to request a Copilot code review.

**Why this priority**: This is an additive convenience feature. It depends on the PR existing (Story 1's detection logic) but is independently valuable.

**Independent Test**: Can be tested by verifying that when `--ask-copilot-review` is passed and a PR exists, `gh pr edit --add-reviewer @copilot` is invoked.

**Acceptance Scenarios**:

1. **Given** a PR exists on the branch and `--ask-copilot-review` is passed, **When** implement-next completes, **Then** `gh pr edit --add-reviewer @copilot` is executed.
2. **Given** a PR exists but `--ask-copilot-review` is NOT passed, **When** implement-next completes, **Then** no reviewer is added.
3. **Given** `--ask-copilot-review` is passed but no PR exists, **When** implement-next completes, **Then** no reviewer command is run and no error occurs.

---

### Edge Cases

- What happens when `gh issue comment` fails to return a comment URL? The tool should warn and continue (non-fatal).
- What happens when editing the comment fails (e.g., permissions)? The tool should warn on stderr and continue.
- What happens when `gh pr edit --add-reviewer @copilot` fails (e.g., old `gh` version)? The tool should warn on stderr and continue.
- What happens when `--no-claude` is combined with `--ask-copilot-review`? Since no AI runs, PR detection still happens post-claim if the flag is present.

## Assumptions

- [AUTO] Comment ID retrieval: `gh issue comment` emits a comment URL that we can use to derive the comment node ID or numeric ID. The implementation should capture and parse the URL from the command output stream it actually appears on, rather than assuming stdout specifically.
- [AUTO] PR detection reuse: We will reuse the existing `getPrInfoGh` pattern from `gitService.ts` to check for an open PR on the current branch, but use a lightweight version that only needs the PR number/URL.
- [AUTO] State storage: No persistent state file needed. The comment ID is captured in-memory during the command run and used immediately after AI invocation completes. This avoids filesystem coupling.
- [AUTO] `Closes #N` placement: The `Closes #N` keyword will be appended to the PR body via `gh pr edit --body` after the PR is detected, rather than requiring the AI skill to include it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `postComment` MUST return the comment URL so the caller can derive the comment ID for later editing.
- **FR-002**: After AI invocation completes (or after claiming when `--no-claude`), the command MUST check if an open PR exists on the current branch.
- **FR-003**: If a PR exists and a comment was posted, the command MUST edit the "working" comment to append the PR number and URL.
- **FR-004**: If a PR exists, the command MUST add `Closes #N` to the PR body to enable auto-close on merge.
- **FR-005**: The `--ask-copilot-review` flag MUST be available on `implement-next`, defaulting to off.
- **FR-006**: When `--ask-copilot-review` is passed and a PR exists, the command MUST run `gh pr edit --add-reviewer @copilot`.
- **FR-007**: All post-AI operations (comment edit, PR body update, copilot review) MUST be non-fatal — failures are warned on stderr but do not change the exit code.

### Key Entities

- **Comment Reference**: The URL/ID returned by `gh issue comment`, used to edit the comment later.
- **PR Reference**: The number and URL of an open PR on the current branch, detected via `gh pr view`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After implement-next completes with a PR on the branch, the "working" comment on the issue contains the PR link.
- **SC-002**: After implement-next completes with a PR, the PR body contains `Closes #N`.
- **SC-003**: When `--ask-copilot-review` is passed and a PR exists, Copilot is added as a reviewer.
- **SC-004**: All new `gh` operations are covered by unit tests with mocked `spawnSync`.
