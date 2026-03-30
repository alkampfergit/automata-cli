# Feature Specification: GitHub Issue Discovery and Auto-Implementation (get-ready)

**Feature Branch**: `003-gh-get-ready`
**Created**: 2026-03-30
**Status**: Draft
**Input**: User description: "the goal is using the gh commandline (return error if azure devops is configured) to get information about a new issue that should be implemented. To identify the new issue we can have different techniques: 1. a specific label, 2. assigned to a specific user, 3. contains a specific string in the title. The exact technique must be configured in the configure mode, and is available only if github mode is available. Once a mode is selected the user can call the new get-ready command that will return the first element that satisfies the condition and is clearly not closed. Once the element is retrieved, use gh to add a new comment that states 'working' and then invoke locally claude code to implement the issue. There will be another setting that is the system prompt for this scenario. Claude code will be invoked using that system prompt followed by the content of the first message of the issue."

## Assumptions

- [AUTO] Issue discovery mode: chose single active mode (only one filter method active at a time) because the CLI is simple and users need one clear method per project; multiple simultaneous filters would complicate the UX and implementation
- [AUTO] First issue ordering: chose "oldest first" (by creation date ascending) because picking the oldest open issue is the most natural backlog priority approach
- [AUTO] Claude Code invocation: chose `claude --system-prompt "<prompt>" "<issue-body>"` as the invocation pattern because the feature description states "system prompt followed by content of the first message"; aligns with how Claude Code CLI accepts prompts
- [AUTO] Issue body extraction: chose the issue body (first message) only, not comments, because the description says "content of the first message of the issue"
- [AUTO] "working" comment: chose to add comment before invoking Claude Code so the comment is visible even if Claude Code fails
- [AUTO] Config storage: chose to extend the existing `.automata/config.json` via `configStore.ts` to remain consistent with the existing `remoteType` storage pattern
- [AUTO] GitHub-only restriction: chose to error immediately if `remoteType` is `"azdo"` or not set to `"gh"` because the feature description explicitly states "return error if azure devops is configured"
- [AUTO] ConfigWizard extension: chose to add new fields to the existing `ConfigWizard.tsx` wizard flow because the description states "must be configured in the configure mode"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure GitHub Issue Discovery (Priority: P1)

A developer configures how the `get-ready` command will find the next issue to work on. They open the existing `automata config` wizard (or use `automata config set` subcommands) and choose a discovery technique: by label, by assignee, or by title string. They also provide the value for the chosen technique and optionally set a system prompt for Claude Code.

**Why this priority**: Configuration must exist before `get-ready` can work. Without a configured discovery method, all other stories fail.

**Independent Test**: Can be tested by running `automata config` and verifying the wizard now includes issue-discovery fields, then checking `.automata/config.json` contains the new keys. Does not require `gh` or Claude Code to be installed.

**Acceptance Scenarios**:

1. **Given** the user runs `automata config`, **When** they navigate the wizard, **Then** they see options for issue discovery technique (label / assignee / title-contains) and a field for the technique value, plus a system prompt field.
2. **Given** the user runs `automata config set issue-discovery-technique label`, **When** they also run `automata config set issue-discovery-value "ready-for-dev"`, **Then** `.automata/config.json` contains `"issueDiscoveryTechnique": "label"` and `"issueDiscoveryValue": "ready-for-dev"`.
3. **Given** `remoteType` is `"azdo"`, **When** the user tries to set `issueDiscoveryTechnique`, **Then** the command succeeds but `get-ready` will later reject it (config set itself is agnostic).
4. **Given** the user sets a system prompt via `automata config set claude-system-prompt "You are a senior engineer..."`, **Then** `.automata/config.json` contains `"claudeSystemPrompt": "<value>"`.

---

### User Story 2 - Retrieve Next Issue (Priority: P2)

A developer runs `automata get-ready` to discover and claim the next open GitHub issue that matches their configured filter. The command finds the first matching open issue, prints its details, and posts a "working" comment on the issue.

**Why this priority**: This is the core retrieval behavior. It delivers value independently — even without Claude Code, developers get a claim workflow.

**Independent Test**: Can be tested by mocking `gh` calls and verifying the command selects the correct issue, prints its number/title/body, and posts a comment. Requires `remoteType` to be `"gh"` and a discovery technique configured.

**Acceptance Scenarios**:

1. **Given** `remoteType` is `"azdo"`, **When** the user runs `automata get-ready`, **Then** the command exits with a non-zero code and prints an error: "Error: get-ready is only available for GitHub (gh) mode."
2. **Given** `remoteType` is `"gh"` but no `issueDiscoveryTechnique` is configured, **When** the user runs `automata get-ready`, **Then** the command exits with an error: "Error: No issue discovery technique configured. Run `automata config` to set one."
3. **Given** `remoteType` is `"gh"`, technique is `"label"`, value is `"ready-for-dev"`, **When** the user runs `automata get-ready`, **Then** the command queries GitHub for open issues with that label, prints the first (oldest) matching issue's number, title, and body, and posts a "working" comment on that issue.
4. **Given** no issues match the configured filter, **When** the user runs `automata get-ready`, **Then** the command prints "No issues found matching the configured filter." and exits with code 0.
5. **Given** a matching issue is found, **When** `--json` is passed, **Then** the command also outputs JSON with `number`, `title`, `body`, and `url` fields.

---

### User Story 3 - Invoke Claude Code on Issue (Priority: P3)

After retrieving the issue, the `get-ready` command automatically invokes Claude Code locally, passing the configured system prompt and the issue body as the prompt. The developer watches Claude Code implement the issue.

**Why this priority**: This is the automation layer on top of retrieval. It extends User Story 2 without breaking it; `get-ready` is still useful without this step if Claude Code is not available.

**Independent Test**: Can be tested by mocking Claude Code invocation and verifying the correct arguments (system prompt + issue body) are passed. Depends on User Story 2 having found an issue.

**Acceptance Scenarios**:

1. **Given** an issue was successfully retrieved and `claudeSystemPrompt` is set, **When** `automata get-ready` runs, **Then** it invokes `claude` with the system prompt and the issue body text as the prompt argument.
2. **Given** `claudeSystemPrompt` is not set, **When** `automata get-ready` runs, **Then** Claude Code is invoked with only the issue body as the prompt (no system prompt).
3. **Given** `claude` is not installed or returns a non-zero exit code, **When** `automata get-ready` runs, **Then** the command prints the error from Claude Code to stderr and exits with a non-zero code; the "working" comment was already posted before invocation.
4. **Given** the `--no-claude` flag is passed, **When** the user runs `automata get-ready`, **Then** the issue is retrieved and the comment is posted but Claude Code is not invoked.

---

### Edge Cases

- What happens when GitHub returns more than 100 matching issues? The command takes only the first result from the paginated response (default page size).
- What happens when the issue body is empty? The command invokes Claude Code with an empty prompt body; it does not error.
- What happens when `gh` is not installed? The command errors: "Error: `gh` CLI is not installed or not on PATH."
- What happens when `gh` is not authenticated? The error from `gh` is surfaced to stderr and the command exits non-zero.
- What happens if the "working" comment cannot be posted (e.g., insufficient permissions)? The error is reported to stderr and the command exits non-zero before invoking Claude Code.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST extend the configuration store to support three new fields: `issueDiscoveryTechnique` (one of `"label"`, `"assignee"`, `"title-contains"`), `issueDiscoveryValue` (string), and `claudeSystemPrompt` (string, optional).
- **FR-002**: The `automata config` wizard MUST display and allow editing of `issueDiscoveryTechnique`, `issueDiscoveryValue`, and `claudeSystemPrompt` when `remoteType` is `"gh"`.
- **FR-003**: The `automata config set` group MUST support `automata config set issue-discovery-technique <value>`, `automata config set issue-discovery-value <value>`, and `automata config set claude-system-prompt <value>` subcommands.
- **FR-004**: A new top-level command `automata get-ready` MUST be added.
- **FR-005**: `automata get-ready` MUST immediately exit with a non-zero error code if `remoteType` is not `"gh"`.
- **FR-006**: `automata get-ready` MUST immediately exit with a non-zero error code if `issueDiscoveryTechnique` is not configured.
- **FR-007**: `automata get-ready` MUST use the `gh` CLI to query open GitHub issues matching the configured filter technique and value, returning the first (oldest) match.
- **FR-008**: `automata get-ready` MUST post a comment "working" on the matched issue using `gh` before invoking Claude Code.
- **FR-009**: `automata get-ready` MUST invoke the `claude` CLI, passing the configured `claudeSystemPrompt` (if set) and the issue body as the prompt.
- **FR-010**: `automata get-ready` MUST support a `--no-claude` flag to skip Claude Code invocation.
- **FR-011**: `automata get-ready` MUST support a `--json` flag that outputs issue details as JSON.
- **FR-012**: When no matching issue is found, `automata get-ready` MUST print a descriptive message and exit with code 0.

### Key Entities

- **AutomataConfig (extended)**: The persisted configuration object, now including `issueDiscoveryTechnique`, `issueDiscoveryValue`, and `claudeSystemPrompt`.
- **GitHubIssue**: A discovered issue with `number`, `title`, `body`, and `url` fields (sourced from `gh issue list` JSON output).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can configure the discovery technique and value in under 30 seconds using `automata config set` commands.
- **SC-002**: `automata get-ready` retrieves the first matching open issue and posts the "working" comment in under 10 seconds on a standard broadband connection.
- **SC-003**: All three discovery techniques (label, assignee, title-contains) work correctly with no additional configuration beyond the technique and value.
- **SC-004**: When `remoteType` is not `"gh"`, `automata get-ready` exits with a non-zero code and a human-readable error message 100% of the time.
- **SC-005**: The `--no-claude` flag allows use of the issue-claim workflow without Claude Code installed, making the feature usable in environments where Claude Code is unavailable.

## Clarifications

### Session 2026-03-30

- Q: Should the config wizard be extended or should there be a separate wizard for GitHub-specific settings? → A: Extend the existing `ConfigWizard` with a second screen shown only when `remoteType` is `"gh"`. [AUTO: Keeps UX unified; consistent with existing wizard pattern in ConfigWizard.tsx]
- Q: Should `get-ready` be a top-level command or a subcommand of `git`? → A: Top-level command `automata get-ready`. [AUTO: The `git` subcommand group is for git workflow operations; issue discovery and Claude invocation is a higher-level automation concern. A top-level command follows the single-responsibility principle]
- Q: What ordering should be used to pick the "first" issue? → A: Oldest first (ascending creation date). [AUTO: Most natural backlog ordering; avoids picking a newly filed issue over long-standing work]
- Q: Should `get-ready` wait for Claude Code to complete before exiting? → A: Yes, wait synchronously using `spawnSync`. [AUTO: Consistent with existing gitService.ts pattern which uses spawnSync; simpler implementation; allows exit code propagation]
- Q: How should the issue body be passed to Claude Code? → A: As a `--print` or `-p` argument with the combined prompt text via stdin or argument. [AUTO: Claude Code CLI supports `-p "<prompt>"` for non-interactive use; system prompt via `--system-prompt` flag if available, otherwise prepend to prompt text]
