# Feature Specification: Get PR Open Comments

**Feature Branch**: `006-get-pr-comments`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "for the git command add a get-pr-comments that will return for github only the list of open comments. check if this feature can be implemented by azdo commandline if not report the gap in the documentation"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - List Unresolved Review Comments on Current PR (Priority: P1)

A developer working on a feature branch wants to see all unresolved review thread comments on their open pull request without leaving the terminal, so they can address reviewer feedback efficiently.

**Why this priority**: This is the core use case. A developer needs a quick way to triage outstanding reviewer feedback without switching to the GitHub web UI.

**Independent Test**: Can be fully tested by running `automata git get-pr-comments` on a branch with an open PR that has unresolved review threads — the command lists each unresolved thread with author, file location, and comment body.

**Acceptance Scenarios**:

1. **Given** a feature branch with an open GitHub PR that has 2 unresolved review threads, **When** the user runs `automata git get-pr-comments`, **Then** the output lists both threads with their author, file path, line number, and comment body.
2. **Given** a feature branch with an open GitHub PR that has no unresolved threads, **When** the user runs `automata git get-pr-comments`, **Then** the output reports "No open comments." and exits with code 0.
3. **Given** a feature branch with no open PR, **When** the user runs `automata git get-pr-comments`, **Then** an error message is written to stderr and the command exits with code 1.

---

### User Story 2 - Machine-Readable JSON Output (Priority: P2)

A developer or automation script needs the unresolved comments as structured JSON so they can be processed programmatically (piped to another tool, stored, or passed to an AI assistant).

**Why this priority**: Consistent with the CLI-first design principle requiring `--json` support on data-output commands; it also unlocks scripting use cases.

**Independent Test**: Running `automata git get-pr-comments --json` on a PR with open comments should produce valid JSON output that a downstream tool can parse without transformation.

**Acceptance Scenarios**:

1. **Given** a PR with unresolved threads, **When** the user runs `automata git get-pr-comments --json`, **Then** stdout contains a JSON array where each element represents an unresolved thread with `author`, `body`, `path`, `line`, and `createdAt` fields.
2. **Given** a PR with no unresolved threads, **When** the user runs `automata git get-pr-comments --json`, **Then** stdout is `[]`.

---

### Edge Cases

- What happens when the remote type is `azdo`? The command must print a clear unsupported message to stderr referencing the gap documentation and exit with code 1.
- What happens when the `gh` CLI is not installed or not authenticated? An actionable error message must be written to stderr.
- What happens when a PR has both resolved and unresolved threads? Only unresolved threads are returned.
- What happens when a review comment is at the file level with no specific line? The line field is displayed as "(file)".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a `get-pr-comments` subcommand under the existing `automata git` command group.
- **FR-002**: When the remote type is `gh` (GitHub), the command MUST fetch all review threads on the pull request for the current branch and return only those that are unresolved.
- **FR-003**: Each unresolved comment thread entry MUST include: the reviewer's login, the comment body, the file path, the line number (or "(file)" if absent), and the creation timestamp.
- **FR-004**: The command MUST support a `--json` flag that outputs a JSON array of unresolved thread entries to stdout; all other output goes to stderr.
- **FR-005**: When there are no unresolved threads, the command MUST output "No open comments." (human-readable) or `[]` (JSON) and exit with code 0.
- **FR-006**: When the remote type is `azdo`, the command MUST write an informative unsupported message to stderr and exit with code 1.
- **FR-007**: The Azure DevOps limitation for `get-pr-comments` MUST be documented as a new gap entry in `docs/azdo-gap.md`.
- **FR-008**: Exit code MUST be 0 on success (including "no open comments"), 1 on any error.

### Key Entities

- **Review Thread**: A group of one or more review comments anchored to a specific file position in a PR. Has a resolved/unresolved status.
- **Comment**: A single reviewer message within a thread. Has an author login, body text, file path, line number, and creation timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with an open PR can retrieve all unresolved review comments with a single command in under 5 seconds on a standard internet connection.
- **SC-002**: The `--json` output is directly parseable by standard JSON tools without any transformation.
- **SC-003**: Running the command when remote type is `azdo` always produces a clear, actionable error message within 1 second.
- **SC-004**: All existing `automata git` commands continue to pass the full test suite after this command is added.

## Assumptions

- [AUTO] Scope of "open comments": interprets "open comments" as unresolved review threads (not general issue-style PR comments), as this is the standard code-review meaning and has the clearest resolved/unresolved distinction in the GitHub data model.
- [AUTO] AzDO CLI capability: assumed not supported because the `azdo` CLI only returns basic PR status with no review thread data, consistent with the existing Gap #2 for check/policy status.
- [AUTO] Thread representation in JSON: each unresolved thread is one JSON object representing the first (top-level) comment of that thread; reply metadata is not included to keep output concise.
- [AUTO] Line number handling: when a review comment has no line anchor (file-level comment), the line field is shown as `null` in JSON and "(file)" in human-readable output.
