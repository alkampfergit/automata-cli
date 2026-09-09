# Feature Specification: Check Issue For New Messages

**Feature Branch**: `feature/029-check-issue-messages`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "Add a method that check a gh issue, it must read the issue, understand if there is a new message from the last execution from one of allowed user. If present, launch Claude or codex with a specific prompt, including issue number and issue conversation. You need to add list of allowed user inside configuration. You need also to include in configuration the user used by the agent. When you will pass the conversation to the prompt you will include only messages of the allowed user and the agent. Find a good way to understand if you have a new message from the last execution. Add a --force to bypass check of new messages and directly invoke the prompt."

## Assumptions

- [AUTO] Command placement: exposed as `automata execute-prompt check-issue <issue-number>` rather than a new top-level command, because it has the same shape as the existing `sonar` and `fix-comments` subcommands (gather remote context → compose a configured prompt → invoke an AI executor) and can reuse their shared `--with/--model/--silent/--push` option contract.
- [AUTO] Last-execution boundary: derived from the issue conversation itself — the most recent comment authored by the configured agent account — instead of a local state file, because a local file would not survive across machines, containers, or CI runners, and the agent account is already part of the required configuration.
- [AUTO] Execution marker: the command posts a short comment on the issue as the agent account before invoking the AI, so the boundary advances even if the AI later produces no comment of its own. This mirrors the existing `implement-next` behaviour, which posts a claim comment before invoking the AI.
- [AUTO] "New message" comparison is by comment creation timestamp; the run proceeds when the newest allowed-user comment is strictly newer than the newest agent comment.
- [AUTO] First execution: when the agent account has never commented on the issue, the issue is treated as having a new message provided the issue body author is allowed or at least one allowed-user comment exists.
- [AUTO] Author matching is case-insensitive, because GitHub logins are case-insensitive.
- [AUTO] GitHub-only, like `implement-next`: an Azure DevOps remote is rejected with a pointer to `docs/azdo-gap.md`, because issue conversation retrieval is not available through `azdo-cli`.
- [AUTO] "No new message" is a successful, non-error outcome (exit code 0), because the command is intended to be run repeatedly from automation loops where "nothing to do" is normal.
- [AUTO] Configuration keys are `allowedUsers` (array of logins) and `agentUser` (single login) at the top level of `.automata/config.json`, and the prompt is configurable under `prompts.checkIssue` with a built-in default, following the existing `prompts.sonar` / `prompts.fixComments` pattern.
- [AUTO] No `--json` output is added, because the command's product is an AI invocation rather than queryable data, matching the existing `execute-prompt` subcommands.
- [AUTO] Both a non-interactive `automata config set` pair and interactive wizard screens are provided, because every existing configuration key is reachable both ways.

## Clarifications

- Q: How should "new message since the last execution" be tracked — local state file, GitHub reaction, or a marker comment from the agent account? → A: Use the newest comment authored by the configured agent account as the boundary, and post an execution marker comment as that account [AUTO: keeps detection stateless and portable across machines and CI, and the agent account is already required configuration for conversation filtering].
- Q: Should the command fail or succeed when there is no new message? → A: Succeed with exit code 0 and an explanatory message on stdout [AUTO: the command is designed for repeated polling, where "nothing to do" is not a failure].
- Q: Should messages from users who are neither allowed nor the agent be able to trigger a run or appear in the prompt? → A: No — they are ignored for both detection and conversation content [AUTO: the issue explicitly restricts the conversation to allowed users and the agent, and letting arbitrary users trigger agent runs would be an unsafe trigger surface].
- Q: What happens when the agent account is also listed in `allowedUsers`? → A: Agent-authored comments never count as new messages [AUTO: otherwise the command would retrigger itself on its own marker comment in an endless loop].
- Q: Should the command take an explicit issue number, or discover the issue using the configured issue-discovery filter? → A: Take a single required issue number argument [AUTO: the request says "check a gh issue" in the singular, and filter-based discovery is already covered by `implement-next`; adding discovery here would duplicate that command].

## User Scenarios & Testing *(mandatory)*

### User Story 1 - React to a new maintainer message on an issue (Priority: P1)

A maintainer leaves a follow-up message on a GitHub issue that an agent has already worked on. The developer (or an automation loop) runs the check command for that issue. The command reads the issue, sees that the maintainer's message is newer than the agent's last message, and launches Claude or Codex with a prompt containing the issue number and the filtered conversation so the agent can act on the new instruction.

**Why this priority**: This is the core value of the feature — turning issue replies into agent runs without a human reading the thread.

**Independent Test**: Configure an allowed user and an agent user, point the command at an issue whose newest allowed-user comment is newer than the newest agent comment, and verify the AI executor is invoked with a prompt containing the issue number and the conversation.

**Acceptance Scenarios**:

1. **Given** an issue whose newest allowed-user comment is newer than the newest agent comment, **When** the command runs, **Then** the AI executor is invoked with a prompt that includes the issue number, title, and the filtered conversation.
2. **Given** the same issue, **When** the command runs, **Then** an execution marker comment is posted on the issue as the agent account before the AI is invoked.
3. **Given** an issue where the agent account has never commented and the issue was opened by an allowed user, **When** the command runs, **Then** the AI executor is invoked.
4. **Given** an issue whose newest comment is from the agent account, **When** the command runs, **Then** no AI executor is invoked, an explanatory message is written to stdout, and the command exits 0.
5. **Given** an issue whose only newer comments are from users who are neither allowed nor the agent, **When** the command runs, **Then** no AI executor is invoked and the command exits 0.

---

### User Story 2 - Restrict who can trigger the agent and what it reads (Priority: P1)

A repository owner configures the list of logins allowed to instruct the agent and the login the agent itself uses. Only those participants can trigger a run, and only their messages plus the agent's own messages are passed to the AI.

**Why this priority**: The trigger surface and the prompt content are both governed by this configuration; the feature cannot ship safely without it.

**Independent Test**: Configure `allowedUsers` and `agentUser`, run the command against an issue containing comments from an unlisted third party, and verify those comments never appear in the composed prompt.

**Acceptance Scenarios**:

1. **Given** an issue with comments from an allowed user, the agent, and an unlisted third party, **When** the prompt is composed, **Then** it contains the allowed user's and agent's comments and omits the third party's comments.
2. **Given** no `allowedUsers` configured, **When** the command runs, **Then** it exits 1 with an error telling the user to configure allowed users.
3. **Given** no `agentUser` configured, **When** the command runs, **Then** it exits 1 with an error telling the user to configure the agent user.
4. **Given** an allowed user login that differs only in letter case from the comment author, **When** detection and filtering run, **Then** the comment is still recognised as belonging to that allowed user.
5. **Given** `allowedUsers` and `agentUser` set through either the interactive wizard or `automata config set`, **When** the command runs, **Then** it reads the same stored values.

---

### User Story 3 - Force a run regardless of message state (Priority: P2)

A developer wants to re-run the agent on an issue even though there is no new message — for example after a failed run, or to re-apply a prompt that changed.

**Why this priority**: Explicitly requested, and it is the escape hatch that makes the automatic detection safe to rely on.

**Independent Test**: Run the command with `--force` against an issue whose newest comment is from the agent account and verify the AI executor is still invoked.

**Acceptance Scenarios**:

1. **Given** an issue with no new allowed-user message, **When** the command runs with `--force`, **Then** the AI executor is invoked with the same prompt it would otherwise compose.
2. **Given** `--force`, **When** the command runs, **Then** the conversation is still filtered to allowed users and the agent.
3. **Given** `--force` and an issue that cannot be read, **When** the command runs, **Then** it still fails with an error rather than invoking the AI with an empty conversation.

### Edge Cases

- What happens when the issue number does not exist or is not readable? The command exits 1 with the underlying error from the GitHub CLI; no AI is invoked and no comment is posted.
- What happens when the issue has no comments at all and was opened by an allowed user? Treated as a first execution with a new message; the issue body is the conversation.
- What happens when the issue has no comments and was opened by a non-allowed user? No new message; exit 0 without invoking the AI (unless `--force`).
- What happens when the issue was opened by a non-allowed user but an allowed user commented? The comment triggers the run and appears in the conversation; the issue description is omitted, and the issue number, title and URL still identify the issue for the agent.
- What happens when the agent account is also listed among the allowed users? Agent messages are still never counted as new messages, so the command cannot retrigger itself.
- What happens when posting the marker comment fails? The command exits 1 before invoking the AI, because losing the boundary marker would cause the same message to be reprocessed on every subsequent run.
- What happens when two allowed-user comments arrive after the last agent comment? Both are marked as new in the conversation passed to the AI, and a single run is started.
- What happens when the remote type is Azure DevOps? The command exits 1 with a pointer to `docs/azdo-gap.md`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The CLI MUST provide a command that takes a GitHub issue number and checks that issue for a new message from an allowed user since the last agent execution.
- **FR-002**: Configuration MUST support a list of allowed user logins that are permitted to instruct the agent.
- **FR-003**: Configuration MUST support the single login used by the agent itself.
- **FR-004**: Both configuration values MUST be settable non-interactively and through the interactive configuration wizard, and MUST persist in the existing configuration file.
- **FR-005**: The command MUST exit with an error when either allowed users or the agent user is unconfigured, naming the missing setting and how to set it.
- **FR-006**: The command MUST determine the last-execution boundary from the most recent issue comment authored by the configured agent user.
- **FR-007**: The command MUST report a new message when at least one comment from an allowed user is newer than that boundary.
- **FR-008**: When the agent user has never commented on the issue, the command MUST treat the issue as having a new message if the issue was opened by an allowed user or any allowed-user comment exists.
- **FR-009**: Comments authored by the agent user MUST never be counted as new messages, even if the agent user is also listed among the allowed users.
- **FR-010**: Comments authored by users who are neither allowed nor the agent MUST NOT count as new messages.
- **FR-011**: When no new message is found, the command MUST write an explanatory message, MUST NOT invoke an AI executor, MUST NOT post a comment, and MUST exit 0.
- **FR-012**: When a new message is found, the command MUST post an execution marker comment on the issue as the agent account before invoking the AI executor, and MUST abort with an error if that comment cannot be posted.
- **FR-013**: The prompt passed to the AI MUST include the issue number, the issue title, the issue URL, and the issue conversation.
- **FR-014**: The conversation included in the prompt MUST contain only messages — the issue description and comments alike — authored by an allowed user or the agent user, in chronological order, each attributed to its author with its timestamp. Messages from any other participant, including the issue description when it was opened by a non-allowed user, MUST be omitted.
- **FR-015**: The conversation MUST distinguish which messages are new since the last agent execution.
- **FR-016**: The prompt text MUST be configurable, with a built-in default used when unconfigured, consistent with the existing configurable prompts.
- **FR-017**: The command MUST support a `--force` option that skips the new-message check and invokes the AI directly, while still applying the same conversation filtering.
- **FR-018**: The command MUST support the same executor selection, model selection, verbosity and push options as the other prompt-execution commands.
- **FR-019**: Author matching for both allowed users and the agent user MUST be case-insensitive.
- **FR-020**: The command MUST reject an Azure DevOps remote configuration with a pointer to the documented gap.
- **FR-021**: Documentation for the command group MUST describe the command, its options, the new configuration keys, the detection rule, and its exit codes.

### Key Entities

- **Allowed user list**: the set of participant logins whose messages may both trigger an agent run and appear in the conversation.
- **Agent user**: the single login the agent posts as; used both as the last-execution boundary and as an included conversation participant.
- **Issue conversation**: the ordered sequence of the issue body plus its comments, each with an author, timestamp, and text.
- **New-message decision**: the outcome of comparing the newest allowed-user message against the last agent message, together with the list of messages considered new.
- **Check-issue prompt**: the configurable instruction text prepended to the issue number and conversation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A maintainer can leave a message on an issue and, with a single command invocation and no manual reading of the thread, have an agent started on that message.
- **SC-002**: Running the command twice in a row with no intervening message starts exactly one agent run.
- **SC-003**: Messages from participants outside the configured allowed list and agent account never appear in the prompt and never start a run, verified by test.
- **SC-004**: A run can be forced with a single option even when no new message exists.
- **SC-005**: All new behaviour — detection, filtering, configuration validation, forcing, and executor selection — is covered by unit tests, and `npm test && npm run lint` passes.
