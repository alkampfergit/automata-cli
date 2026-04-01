# Feature Specification: Sonar Failure Details in get-pr-info

**Feature Branch**: `012-sonar-failure-details`  
**Created**: 2026-04-01  
**Status**: Draft  
**Input**: User description: "When get-pr-info sees a failing SonarCloud check, include gate violations and issue details from the public SonarCloud API in the return value; if the project is private and Sonar returns 401, say the project is private and advise using the Sonar URL in an authenticated browser."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inspect Public Sonar Failures from the CLI (Priority: P1)

As a developer running `automata git get-pr-info`, I want a failing public SonarCloud check to include the quality gate violations and issue details directly in the command output, so I can fix the problems without opening SonarCloud in a browser.

**Why this priority**: This is the direct user value requested. Without it, the command still forces the user or an AI agent to leave the terminal to inspect the failure.

**Independent Test**: Run `automata git get-pr-info` against a PR whose SonarCloud project is public and whose Sonar check is failing; verify the output includes a `Sonar Failures:` section with gate and issue details.

**Acceptance Scenarios**:

1. **Given** a PR with a failing SonarCloud check for a public project, **When** I run `automata git get-pr-info`, **Then** the output includes a `Sonar Failures:` section after the standard PR summary.
2. **Given** the SonarCloud quality gate is failing for one or more conditions, **When** I run `automata git get-pr-info`, **Then** the `Sonar Failures:` section lists each violated condition with enough detail to understand the gate failure.
3. **Given** the SonarCloud analysis has issues attached to the pull request, **When** I run `automata git get-pr-info`, **Then** the `Sonar Failures:` section lists issue details including description and location when Sonar provides them.
4. **Given** the SonarCloud analysis exposes explanatory text for an issue, **When** I run `automata git get-pr-info`, **Then** that explanation is included in the Sonar failure details.

---

### User Story 2 - Consume Sonar Failure Details Programmatically (Priority: P2)

As a developer or AI workflow using `automata git get-pr-info --json`, I want structured Sonar failure data in the JSON payload, so scripts and agents can act on the problems without scraping terminal text.

**Why this priority**: The user explicitly wants `get-pr-info` to return enough detail for Claude or Codex to fix the issues directly. Machine-readable output is the most reliable way to do that.

**Independent Test**: Run `automata git get-pr-info --json` against a PR with a failing public SonarCloud check and verify the JSON includes structured gate and issue detail objects.

**Acceptance Scenarios**:

1. **Given** a failing public SonarCloud check, **When** I run `automata git get-pr-info --json`, **Then** the JSON includes structured Sonar failure data in addition to the existing `sonarcloudUrl`.
2. **Given** SonarCloud returns one or more quality gate violations, **When** I inspect the JSON output, **Then** each violation is represented as a distinct structured item rather than collapsed into a single string.
3. **Given** SonarCloud returns issue details for the PR, **When** I inspect the JSON output, **Then** each issue includes severity or type when available and file/line location when available.

---

### User Story 3 - Handle Private SonarCloud Projects Gracefully (Priority: P3)

As a developer running `automata git get-pr-info` against a private SonarCloud project, I want a clear note that API details are unavailable because the project is private, so I know I must open the Sonar URL in an authenticated browser instead of assuming the CLI is broken.

**Why this priority**: The requested behavior distinguishes "no data" from "private project". That removes ambiguity and keeps the command actionable even when the public API cannot be used.

**Independent Test**: Run `automata git get-pr-info` against a PR whose SonarCloud project returns HTTP 401 from the public API and verify the output explains that the project is private and points the user to the Sonar URL.

**Acceptance Scenarios**:

1. **Given** a PR with a failing SonarCloud check for a private project, **When** the SonarCloud public API returns HTTP 401, **Then** `automata git get-pr-info` states that the SonarCloud project is private and advises opening the Sonar URL in an authenticated browser.
2. **Given** `--json` output for the same private-project case, **When** I inspect the result, **Then** the JSON includes a machine-readable note that the project is private rather than exposing empty ambiguous fields.
3. **Given** a PR whose SonarCloud check is passing, **When** I run `automata git get-pr-info`, **Then** no `Sonar Failures:` section is shown and existing non-failure behavior remains unchanged.

### Edge Cases

- What happens when SonarCloud is detected but the check is not failing? The command keeps the existing Sonar URL and new-issue behavior but does not print a `Sonar Failures:` section.
- What happens when SonarCloud returns partial data, such as gate violations without issues or issues without line numbers? The command includes whatever detail is available and omits missing fields without failing the command.
- What happens when the SonarCloud API is temporarily unavailable for a public project? The command preserves the Sonar URL and existing check output, and marks Sonar failure details as unavailable rather than crashing.
- What happens when there are many Sonar issues? The command returns all issues provided for the PR query without truncating them silently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `get-pr-info` MUST detect when a SonarCloud check is both present and failing.
- **FR-002**: When a failing SonarCloud check points to a public project, `get-pr-info` MUST query the public SonarCloud API for quality gate details associated with that pull request.
- **FR-003**: When a failing SonarCloud check points to a public project, `get-pr-info` MUST query the public SonarCloud API for issue details associated with that pull request.
- **FR-004**: Human-readable `get-pr-info` output MUST include a `Sonar Failures:` section when Sonar failure details are available.
- **FR-005**: The `Sonar Failures:` section MUST include a gate-violation subsection or entries that describe each failing quality gate condition returned by SonarCloud.
- **FR-006**: The `Sonar Failures:` section MUST include issue entries with description and location when SonarCloud provides those fields.
- **FR-007**: The `--json` output for `get-pr-info` MUST include structured Sonar failure data that distinguishes gate violations, issues, and private-project notes.
- **FR-008**: If the SonarCloud public API returns HTTP 401 for the relevant project, `get-pr-info` MUST indicate that the SonarCloud project is private and advise using the Sonar URL in an authenticated browser.
- **FR-009**: A private-project Sonar response MUST NOT cause `get-pr-info` to fail or exit non-zero when the base PR information was retrieved successfully.
- **FR-010**: Existing `get-pr-info` output for non-Sonar checks and for passing Sonar checks MUST remain backward-compatible except for the addition of new optional Sonar detail fields.

### Key Entities

- **Sonar Failure Summary**: Structured SonarCloud data attached to PR info when a Sonar check fails. It can contain quality gate violations, Sonar issues, or a private-project note.
- **Gate Violation**: A single failing quality gate condition reported by SonarCloud, such as a metric not meeting its threshold on new code.
- **Sonar Issue Detail**: A SonarCloud issue tied to the pull request analysis, with fields such as rule, message, severity, type, file path, line, and explanation when present.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a PR with a failing public SonarCloud check, a developer can identify the blocking gate conditions and affected files from one `automata git get-pr-info` invocation.
- **SC-002**: For a PR with a failing private SonarCloud check, the command clearly identifies the privacy/authentication limitation instead of returning an unexplained missing value.
- **SC-003**: `automata git get-pr-info --json` returns structured Sonar failure data that can be consumed by an AI workflow without parsing the human-readable section.
- **SC-004**: Existing successful or non-Sonar `get-pr-info` flows continue to pass their current tests without behavior regressions.

## Clarifications

- No critical ambiguities detected during autonomous clarification.

## Assumptions

- [AUTO] Sonar failure scope: only fetch expanded Sonar failure details when the Sonar check is failing, because the request specifically targets failing checks and this keeps normal successful output stable.
- [AUTO] Public/private detection: treat HTTP 401 from the SonarCloud API as the private-project signal, because the user explicitly requested that behavior.
- [AUTO] Output strategy: keep the existing top-level Sonar URL line and add a dedicated `Sonar Failures:` section, because it preserves compatibility while making failure details easy for humans and agents to find.
- [AUTO] Issue detail depth: include the fields SonarCloud already exposes for the PR query rather than inventing derived explanations, because the goal is actionable source data for Claude or Codex.
