# Feature Specification: Git Workflow Commands

**Feature Branch**: `002-git-commands`
**Created**: 2026-03-30
**Status**: Draft
**Input**: User description: "the ability to interact with a commandline to execute commands for other commandline. In this first spec I need to be able to use git and gh, to generate these commands: 1. automata git get-pr-info (will return info about a pr if it is opened on current branch) 2. automata git finish-feature (will check if the current branch corresponds to a closed pull request, if yes and the upstream is gone checkout develop, pull and then delete local branch)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get PR Info for Current Branch (Priority: P1)

A developer working on a feature branch wants to quickly see if a pull request is open for their current branch, and get its details (number, title, state, URL) without switching context to the GitHub web interface.

**Why this priority**: This is the simpler of the two commands and provides immediate value by surfacing PR status directly in the terminal. It also serves as a building block for the finish-feature command.

**Independent Test**: Can be fully tested by running `automata git get-pr-info` on a branch that has an open PR and verifying the output contains the PR number, title, state, and URL.

**Acceptance Scenarios**:

1. **Given** the current branch has an open pull request on GitHub, **When** the user runs `automata git get-pr-info`, **Then** the command outputs the PR number, title, state, and URL.
2. **Given** the current branch has no pull request, **When** the user runs `automata git get-pr-info`, **Then** the command outputs a clear message that no PR exists for this branch and exits with code 0.
3. **Given** the user passes `--json`, **When** the command runs, **Then** the output is valid JSON containing all PR fields.
4. **Given** no GitHub credentials are configured, **When** the user runs `automata git get-pr-info`, **Then** the command outputs a meaningful error to stderr and exits with a non-zero code.

---

### User Story 2 - Finish Feature Branch Cleanup (Priority: P2)

A developer has merged their feature pull request and wants to clean up their local environment: switch back to the `develop` branch, pull the latest changes, and delete the now-merged local feature branch — all with a single command.

**Why this priority**: This automates a repetitive multi-step cleanup workflow that is error-prone if done manually. It depends on the PR state check capability introduced in User Story 1.

**Independent Test**: Can be fully tested by running `automata git finish-feature` on a branch whose PR is closed/merged and whose remote tracking branch is gone, and verifying the local branch is deleted, develop is checked out, and pulled.

**Acceptance Scenarios**:

1. **Given** the current branch has a merged PR and the remote tracking branch no longer exists, **When** the user runs `automata git finish-feature`, **Then** the command checks out `develop`, pulls the latest, and deletes the local feature branch.
2. **Given** the current branch has an open PR (not yet merged), **When** the user runs `automata git finish-feature`, **Then** the command aborts with a clear message indicating the PR is still open and exits with a non-zero code.
2b. **Given** the current branch has a closed PR that was NOT merged, **When** the user runs `automata git finish-feature`, **Then** the command aborts with a message indicating the PR was closed without merging, and exits with a non-zero code.
3. **Given** the current branch's remote tracking branch still exists (upstream not gone), **When** the user runs `automata git finish-feature`, **Then** the command aborts with a message that the upstream branch still exists and exits with a non-zero code.
4. **Given** the user is already on the `develop` branch, **When** the user runs `automata git finish-feature`, **Then** the command aborts with a message that finish-feature cannot run on the develop branch.
5. **Given** the current branch has no associated PR at all, **When** the user runs `automata git finish-feature`, **Then** the command aborts with a message that no PR is found for this branch.

---

### Edge Cases

- What happens when `gh` CLI is not installed or not authenticated?
- What happens when the git repository has no remote configured?
- What happens when the `develop` branch does not exist locally?
- What happens when there are uncommitted changes on the feature branch before switching?
- What happens when the pull from develop fails (network error, merge conflict)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The CLI MUST expose a `git` subcommand group under the `automata` root command.
- **FR-002**: The `automata git get-pr-info` command MUST detect the current git branch and query GitHub for an associated pull request.
- **FR-003**: The `get-pr-info` command MUST display PR number, title, state, and URL when a PR is found.
- **FR-004**: The `get-pr-info` command MUST output a clear "no PR found" message when no PR exists for the current branch and exit with code 0.
- **FR-005**: The `get-pr-info` command MUST support a `--json` flag that outputs all PR fields as valid JSON.
- **FR-006**: The `automata git finish-feature` command MUST verify the current branch has a merged pull request (state: `merged`) before proceeding; a PR that is closed without merging does NOT qualify.
- **FR-007**: The `finish-feature` command MUST verify that the remote tracking branch for the current branch no longer exists before proceeding.
- **FR-008**: The `finish-feature` command MUST checkout the `develop` branch, pull the latest changes, then delete the local feature branch.
- **FR-009**: The `finish-feature` command MUST abort with a non-zero exit code and an informative stderr message if any precondition is not met (PR still open, upstream still exists, already on develop, no PR found).
- **FR-010**: Both commands MUST output errors to stderr and non-error output to stdout.
- **FR-011**: Both commands MUST exit with code 0 on success and non-zero on error.
- **FR-012**: Both commands MUST fail gracefully with a descriptive error when `gh` CLI is not available or not authenticated.

### Key Entities

- **Pull Request**: A GitHub pull request associated with the current branch. Key attributes: number, title, state (open/closed/merged), URL, head branch name.
- **Feature Branch**: The local git branch the developer is currently on. Identified by `git rev-parse --abbrev-ref HEAD`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can retrieve PR info for their current branch in under 3 seconds in a typical network environment.
- **SC-002**: `get-pr-info` returns the correct PR state, number, title, and URL for any branch with an open or closed PR.
- **SC-003**: `finish-feature` completes the full cleanup sequence (checkout develop, pull, delete branch) in a single command when all preconditions are met.
- **SC-004**: Both commands produce clear, actionable error messages for all identified failure scenarios, enabling users to resolve issues without consulting documentation.
- **SC-005**: Both commands behave correctly in all defined edge cases with no unhandled exceptions.

## Clarifications

### Session 2026-03-30

- Q: Should `finish-feature` treat any closed PR (including closed-without-merge) as valid for cleanup, or only merged PRs? → A: Only PRs with state `merged` qualify — a PR closed without merging may indicate a rejected or abandoned branch that the user might want to keep. [AUTO: safest default prevents accidental branch deletion for rejected PRs]
- Q: What fields and format should `get-pr-info` display in human-readable mode? → A: Display PR number, title, state, and URL as labelled key-value lines (e.g. `PR:    #42`). [AUTO: matches Unix tool conventions, minimal and readable without dependencies]

## Assumptions

- [AUTO] Target remote: GitHub only (via `gh` CLI), not Azure DevOps — the user explicitly mentioned `git` and `gh` as the tools; Azure DevOps support is out of scope for this spec.
- [AUTO] Default integration branch: `develop` — the project uses GitFlow, where `develop` is the main integration branch as confirmed by CLAUDE.md.
- [AUTO] PR detection: uses `gh pr view --json` to query PR state — this is the standard `gh` CLI approach and avoids implementing raw GitHub API calls.
- [AUTO] Remote tracking branch detection: uses `git ls-remote --exit-code` or `git for-each-ref` to detect if the upstream branch still exists — standard git tooling, no extra dependencies.
- [AUTO] Uncommitted changes handling: `finish-feature` will abort if there are uncommitted changes, deferring stash/discard decisions to the user — safest default to avoid data loss.
- [AUTO] Output format for `get-pr-info`: human-readable table/key-value by default, JSON with `--json` flag — consistent with project constitution (CLI-First, `--json` flag).
