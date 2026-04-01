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
2. **Given** that SonarCloud check has failed, **When** `automata git get-pr-info` is run, **Then** the trailing `FailedChecks:` section includes the Sonar URL for that failure.
3. **Given** a branch with an open PR that has no SonarCloud check, **When** `automata git get-pr-info` is run, **Then** no SonarCloud fields appear in the output.
4. **Given** `--json` flag, **When** `automata git get-pr-info --json` is run on a PR with SonarCloud, **Then** JSON output includes `sonarcloudUrl` and `sonarNewIssues` fields.

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

A developer runs `automata execute-prompt sonar` on a feature branch. The tool looks up the current SonarCloud analysis URL from the PR status, then invokes Claude (or Codex with `--codex`) with the stored Sonar prompt, passing both the analysis URL and the structured Sonar-related data from `automata git get-pr-info --json` as context so the AI can fix the reported issues without re-fetching basic Sonar details.

**Why this priority**: The primary end-to-end value of the feature; depends on stories 1–3.

**Independent Test**: Can be fully tested by running `execute-prompt sonar` on a branch with a SonarCloud analysis and confirming the AI is invoked with a prompt containing the SonarCloud URL and the structured `get-pr-info` payload for that PR.

**Acceptance Scenarios**:

1. **Given** a branch with a PR that has a SonarCloud analysis URL, **When** `automata execute-prompt sonar` is run, **Then** Claude is invoked with the Sonar custom prompt, the SonarCloud URL, and the structured `get-pr-info` payload for that PR.
2. **Given** the repository exposes a `sonar-quality-gate` skill, **When** `automata execute-prompt sonar` is run, **Then** the prompt instructs the AI to use that skill.
3. **Given** the SonarCloud analysis contains metric-based quality gate failures such as duplication, **When** `automata execute-prompt sonar` is run, **Then** the prompt instructs the AI to inspect both Sonar issues and the quality gate via API rather than relying only on the issues endpoint.
4. **Given** `get-pr-info` has already resolved structured Sonar failure details such as `sonarFailures`, **When** `automata execute-prompt sonar` is run, **Then** those details are embedded in the AI prompt so the model can start from the known terminal context.
5. **Given** `--codex` flag, **When** `automata execute-prompt sonar --codex` is run, **Then** Codex CLI is used instead of Claude.
6. **Given** `--verbose` flag, **When** `automata execute-prompt sonar --verbose` is run with Claude, **Then** verbose progress is shown.
7. **Given** no SonarCloud URL is found on the PR, **When** `automata execute-prompt sonar` is run, **Then** an informative error is shown and the command exits non-zero.

---

### User Story 5 - Execute-Prompt Fix-Comments Command (Priority: P4)

A developer runs `automata execute-prompt fix-comments` on a feature branch. The tool fetches open review comments from the PR via the GitHub GraphQL API, then invokes Claude (or Codex with `--codex`) with the stored Fix-Comments prompt and the formatted comment list as context so the AI can address each reviewer concern.

**Why this priority**: Parallel value to the sonar command; completes the prompt-execution command group and removes the manual step of copying review comments into an AI prompt.

**Independent Test**: Can be fully tested by running `execute-prompt fix-comments` on a branch whose PR has open review comments and confirming the AI is invoked with a prompt containing those comments.

**Acceptance Scenarios**:

1. **Given** a branch with a PR that has open review comments, **When** `automata execute-prompt fix-comments` is run, **Then** Claude is invoked with the Fix-Comments prompt and the formatted comment list.
2. **Given** `--codex` flag, **When** `automata execute-prompt fix-comments --codex` is run, **Then** Codex CLI is used instead of Claude.
3. **Given** `--verbose` flag, **When** `automata execute-prompt fix-comments --verbose` is run with Claude, **Then** verbose progress is shown.
4. **Given** no open review comments on the PR, **When** `automata execute-prompt fix-comments` is run, **Then** an informative error is shown and the command exits non-zero.
5. **Given** an Azure DevOps remote, **When** `automata execute-prompt fix-comments` is run, **Then** an unsupported-remote error is shown and the command exits non-zero.
6. **Given** no PR exists for the current branch, **When** `automata execute-prompt fix-comments` is run, **Then** an informative error is shown and the command exits non-zero.

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
- **FR-004A**: When a SonarCloud check is failed, the human-readable `FailedChecks:` section of `get-pr-info` MUST include the Sonar URL for that failure.
- **FR-005**: The config wizard MUST present a top-level menu with sections: "Remote / Mode", "Implement-Next", and "Prompts".
- **FR-006**: The "Prompts" section MUST allow viewing and editing a custom Sonar prompt.
- **FR-007**: The config schema MUST be extended with a `prompts` object containing at minimum `sonar` and `fixComments` string fields.
- **FR-008**: A built-in default Sonar prompt MUST be defined in code and used when no custom prompt is configured.
- **FR-008A**: The built-in default Sonar prompt MUST instruct the AI to inspect both Sonar issues and the Sonar quality gate via API.
- **FR-008B**: The built-in default Sonar prompt MUST instruct the AI to use the `sonar-quality-gate` skill when that skill is available in the repository.
- **FR-009**: `automata execute-prompt sonar` MUST look up the SonarCloud URL for the current branch's PR.
- **FR-010**: `execute-prompt sonar` MUST invoke the AI (Claude by default, Codex with `--codex`) with the Sonar prompt and SonarCloud URL as context.
- **FR-010A**: `execute-prompt sonar` MUST append the structured `get-pr-info` result for the current PR to the AI prompt.
- **FR-010B**: The appended `get-pr-info` context for `execute-prompt sonar` MUST preserve Sonar-related fields returned by `get-pr-info`, including `sonarcloudUrl`, `sonarNewIssues`, and `sonarFailures` when present.
- **FR-011**: `execute-prompt sonar` MUST support `--verbose` flag (Claude only) and `--codex` flag.
- **FR-012**: `execute-prompt sonar` MUST exit with a non-zero code and informative message when no SonarCloud URL is found.
- **FR-013**: `get-pr-info` MUST handle SonarCloud API failures gracefully (show URL without issue count).
- **FR-014**: `automata execute-prompt fix-comments` MUST fetch open review comments from the current branch's PR via the GitHub GraphQL API and invoke the AI with the Fix-Comments prompt and formatted comment list.
- **FR-015**: `execute-prompt fix-comments` MUST exit with a non-zero code and informative message when: no PR exists, no open comments are found, or the remote is Azure DevOps.
- **FR-016**: A built-in default Fix-Comments prompt MUST be defined in code and used when no custom prompt is configured.
- **FR-016A**: The "Prompts" section of the config wizard MUST allow viewing and editing a custom Fix-Comments prompt, stored under `prompts.fixComments`.

### Key Entities

- **SonarCloud Check**: A PR status check whose detail URL contains `sonarcloud.io`; carries a project URL and PR analysis key.
- **Custom Prompt**: A user-editable string stored in `.automata/config.json` under `prompts.<name>`; has a code-level default fallback.
- **SonarCloud Analysis**: A SonarCloud API response object containing `newIssues` count for a specific PR analysis.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can see SonarCloud new-issue count without leaving the terminal when running `get-pr-info`.
- **SC-002**: `automata config` presents a navigable menu; all existing settings remain reachable.
- **SC-003**: Running `execute-prompt sonar` on a PR with SonarCloud issues triggers an AI invocation within 5 seconds of finding the URL and includes the structured `get-pr-info` context in the AI prompt.
- **SC-004**: A Sonar prompt can be customized and is persisted across automata restarts.
- **SC-005**: Running `execute-prompt fix-comments` on a PR with open review comments triggers an AI invocation with those comments embedded in the prompt.
- **SC-006**: A Fix-Comments prompt can be customized and is persisted across automata restarts.

## Assumptions

- [AUTO] SonarCloud detection method: URL pattern match on `sonarcloud.io` in the check's `detailsUrl` field — because checks already carry `detailsUrl` and this avoids a name-based heuristic that may break across localizations.
- [AUTO] SonarCloud API coverage: the default prompt references both `/api/issues/search` and quality-gate or measures APIs because issue search alone does not surface duplication-based gate failures.
- [AUTO] Execute-prompt Sonar context: append the structured `get-pr-info` payload in addition to the Sonar URL so the AI can start from already-resolved terminal context and only fall back to direct Sonar APIs when needed.
- [AUTO] Sonar project key extraction: extracted from the SonarCloud check URL `id` query parameter — aligned with the current implementation of the SonarCloud integration.
- [AUTO] Default Sonar prompt: instructs the AI to use Sonar APIs directly, inspect both the quality gate and issue list, and use the local `sonar-quality-gate` skill when present.
- [AUTO] Implement-Next settings in config wizard: exposes the existing `issueDiscoveryTechnique` and `issueDiscoveryValue` fields — avoids scope creep.
- [AUTO] execute-prompt is a new top-level command group (not under `git`) — consistent with it being an AI-invocation workflow, not a git workflow.
- [AUTO] `--yolo` flag not added to `execute-prompt sonar` — not mentioned in feature description; follow YAGNI.
