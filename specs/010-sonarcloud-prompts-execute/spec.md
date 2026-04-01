# Feature Specification: SonarCloud Integration, Expanded Config, and Execute-Prompt Command

**Feature Branch**: `010-sonarcloud-prompts-execute`  
**Created**: 2026-04-01  
**Status**: Draft  

## User Scenarios & Testing *(mandatory)*

### User Story 1 - SonarCloud Data in get-pr-info (Priority: P1)

A developer runs `automata git get-pr-info` on a branch whose PR has a SonarCloud check. They want to see both the SonarCloud project URL and the number of new issues detected in that PR without having to visit the SonarCloud dashboard manually.

**Why this priority**: Provides immediate blocking-issue awareness in the existing PR info workflow; no new commands required.

**Independent Test**: Can be fully tested by running `get-pr-info` on a branch with a SonarCloud check and confirming that the output includes a `sonarcloudUrl` field and a `newIssues` count.

**Acceptance Scenarios**:

1. **Given** a branch with an open PR that has a SonarCloud check, **When** `automata git get-pr-info` is run, **Then** the output includes the SonarCloud project URL and new-issue count.
2. **Given** a branch with an open PR that has no SonarCloud check, **When** `automata git get-pr-info` is run, **Then** no SonarCloud fields appear in the output.
3. **Given** `--json` flag, **When** `automata git get-pr-info --json` is run on a PR with SonarCloud, **Then** JSON output includes `sonarcloudUrl` and `sonarNewIssues` fields.

---

### User Story 2 - Expanded Config Wizard with Menus (Priority: P2)

A developer runs `automata config` and sees a top-level menu that lets them navigate to sub-sections: remote type, implement-next settings, and custom prompts — replacing the previous linear wizard flow.

**Why this priority**: The configuration surface is growing; a menu-driven UI prevents overwhelming a single linear form.

**Independent Test**: Can be fully tested by running `automata config` and verifying the top-level menu renders with the three sections, each selectable and editable.

**Acceptance Scenarios**:

1. **Given** `automata config` is run, **When** the wizard launches, **Then** a main menu lists: "Remote / Mode", "Implement-Next", and "Prompts".
2. **Given** user selects "Remote / Mode", **When** they configure and confirm, **Then** `remoteType` is written to config.
3. **Given** user selects "Prompts", **When** they navigate to "Sonar", **Then** they can view and edit the Sonar custom prompt text.
4. **Given** user selects "Implement-Next", **When** they configure, **Then** implement-next related settings are saved.

---

### User Story 3 - Custom Prompt Storage in Config (Priority: P3)

An operator wants to store a reusable "fix Sonar issues" prompt in the automata config file so that the `execute-prompt sonar` command can use it without requiring the user to type it each time.

**Why this priority**: Foundational data layer for the execute-prompt command; without it the command cannot operate.

**Independent Test**: Can be fully tested by setting a custom sonar prompt via `automata config`, reading the config file, and confirming the `prompts.sonar` field is present.

**Acceptance Scenarios**:

1. **Given** a user edits the Sonar prompt in the config wizard, **When** they save, **Then** `.automata/config.json` contains a `prompts.sonar` string.
2. **Given** no sonar prompt has been configured, **When** config is read, **Then** a built-in default prompt is used by execute-prompt.

---

### User Story 4 - Execute-Prompt Sonar Command (Priority: P4)

A developer runs `automata execute-prompt sonar` on a feature branch. The tool looks up the current SonarCloud analysis URL from the PR status, then invokes Claude (or Codex with `--codex`) with the stored Sonar prompt, passing the analysis URL as context so the AI can fix the reported issues.

**Why this priority**: The primary end-to-end value of the feature; depends on stories 1–3.

**Independent Test**: Can be fully tested by running `execute-prompt sonar` on a branch with a SonarCloud analysis and confirming the AI is invoked with a prompt containing the SonarCloud URL.

**Acceptance Scenarios**:

1. **Given** a branch with a PR that has a SonarCloud analysis URL, **When** `automata execute-prompt sonar` is run, **Then** Claude is invoked with the Sonar custom prompt and the SonarCloud URL.
2. **Given** `--codex` flag, **When** `automata execute-prompt sonar --codex` is run, **Then** Codex CLI is used instead of Claude.
3. **Given** `--verbose` flag, **When** `automata execute-prompt sonar --verbose` is run with Claude, **Then** verbose progress is shown.
4. **Given** no SonarCloud URL is found on the PR, **When** `automata execute-prompt sonar` is run, **Then** an informative error is shown and the command exits non-zero.

---

### Edge Cases

- What happens when the SonarCloud API is unreachable? Output should show URL but `newIssues` as unavailable, without crashing.
- What happens when the SonarCloud project is private? Skip the new-issue count and note that auth is required.
- What happens when no PR exists for the current branch? `execute-prompt sonar` exits with a clear error.
- What happens when both `--codex` and `--verbose` are passed? `--verbose` is silently ignored (only applies to Claude).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `get-pr-info` MUST detect whether any check in the PR status rollup is a SonarCloud check (by URL pattern matching `sonarcloud.io`).
- **FR-002**: When SonarCloud is detected, `get-pr-info` MUST extract the SonarCloud project URL from the check details.
- **FR-003**: When SonarCloud is detected, `get-pr-info` MUST query the SonarCloud public API (no auth) to fetch the count of new issues for the PR.
- **FR-004**: The new-issue count and SonarCloud URL MUST be included in both human-readable and `--json` output of `get-pr-info`.
- **FR-005**: The config wizard MUST present a top-level menu with sections: "Remote / Mode", "Implement-Next", and "Prompts".
- **FR-006**: The "Prompts" section MUST allow viewing and editing a custom Sonar prompt.
- **FR-007**: The config schema MUST be extended with a `prompts` object containing at minimum a `sonar` string field.
- **FR-008**: A built-in default Sonar prompt MUST be defined in code and used when no custom prompt is configured.
- **FR-009**: `automata execute-prompt sonar` MUST look up the SonarCloud URL for the current branch's PR.
- **FR-010**: `execute-prompt sonar` MUST invoke the AI (Claude by default, Codex with `--codex`) with the Sonar prompt and SonarCloud URL as context.
- **FR-011**: `execute-prompt sonar` MUST support `--verbose` flag (Claude only) and `--codex` flag.
- **FR-012**: `execute-prompt sonar` MUST exit with a non-zero code and informative message when no SonarCloud URL is found.
- **FR-013**: `get-pr-info` MUST handle SonarCloud API failures gracefully (show URL without issue count).

### Key Entities

- **SonarCloud Check**: A PR status check whose detail URL contains `sonarcloud.io`; carries a project URL and PR analysis key.
- **Custom Prompt**: A user-editable string stored in `.automata/config.json` under `prompts.<name>`; has a code-level default fallback.
- **SonarCloud Analysis**: A SonarCloud API response object containing `newIssues` count for a specific PR analysis.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can see SonarCloud new-issue count without leaving the terminal when running `get-pr-info`.
- **SC-002**: `automata config` presents a navigable menu; all existing settings remain reachable.
- **SC-003**: Running `execute-prompt sonar` on a PR with SonarCloud issues triggers an AI invocation within 5 seconds of finding the URL.
- **SC-004**: A Sonar prompt can be customized and is persisted across automata restarts.

## Assumptions

- [AUTO] SonarCloud detection method: URL pattern match on `sonarcloud.io` in the check's `detailsUrl` field — because checks already carry `detailsUrl` and this avoids a name-based heuristic that may break across localizations.
- [AUTO] SonarCloud API endpoint: uses `/api/issues/search?componentKeys=<project>&pullRequest=<number>&resolved=false` (public API, no auth needed for public projects) — industry standard for SonarCloud public project access.
- [AUTO] Sonar project key extraction: extracted from the SonarCloud check URL path segment before `/dashboard` — consistent with how SonarCloud structures its URLs.
- [AUTO] Default Sonar prompt: instructs the AI to read the SonarCloud analysis at the given URL and fix the reported new issues — minimal viable default.
- [AUTO] Implement-Next settings in config wizard: exposes the existing `issueDiscoveryTechnique` and `issueDiscoveryValue` fields — avoids scope creep.
- [AUTO] execute-prompt is a new top-level command group (not under `git`) — consistent with it being an AI-invocation workflow, not a git workflow.
- [AUTO] `--yolo` flag not added to `execute-prompt sonar` — not mentioned in feature description; follow YAGNI.
