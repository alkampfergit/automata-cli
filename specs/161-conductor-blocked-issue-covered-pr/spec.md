# Feature Specification: Conductor covered pull request

**Feature Branch**: `feature/161-conductor-blocked-issue-covered-pr`
**Created**: 2026-10-19
**Status**: Draft
**Input**: Issue #161 — a pull request is silenced by its watched issue even when that issue cannot reply

## User Scenarios & Testing

### User Story 1 - A blocked issue does not hide its pull request (Priority: P1)

A maintainer watches issue #157 and its pull request #160. #157 has the `conductor-blocked` label. #160 has Copilot
review threads. The conductor must reply on #160.

**Acceptance Scenarios**:
1. **Given** a watched issue with `conductor-blocked` and a watched linked pull request, **When** a tick runs,
   **Then** the pull request is decided on its own.
2. **Given** a watched issue at the reply limit, **Then** the same.
3. **Given** a watched issue that can reply, **Then** the pull request is still covered, as before.

### User Story 2 - A clear covered line (Priority: P2)

The covered line names where the replies of the pull request are decided.

## Requirements

- **FR-001**: `coveredByWatchedIssue` accepts a `canReply` predicate; an issue that cannot reply covers nothing.
- **FR-002**: The conductor treats an issue as unable to reply when it has the `conductor-blocked` label or its
  reply count has reached `conductor.maxRepliesPerItem`.
- **FR-003**: The covered line reads `#<pr> is covered by watched issue #<issue>; its replies, including Copilot review
  threads, are decided there.`
- **FR-004**: `docs/conductor.md` and `CHANGELOG.md` describe the change.
- **FR-005**: Story-child coverage does not change.

## Assumptions

- [AUTO] Option: chose option 1 of the issue (the block label on an issue does not block its pull requests), as the
  user approved.
- [AUTO] Run lock: not part of coverage; the agent-is-working wait already applies to each turn.
- [AUTO] Read failure of the issue: counts as "can reply"; `conductItem` reports the failure.
