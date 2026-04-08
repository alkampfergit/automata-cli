# Feature Specification: implement-next Multi-Issue Selection

**Feature Branch**: `013-implement-next-selection`  
**Created**: 2026-04-02  
**Status**: Draft  
**Input**: User description: "When we run implement-next if I have more than one issue that match the tool should present the list of the first 10 elements and let the user choose, if there are more than 10 element simply state that these are the first 10 ready elements. If we have one element only or if --take-first is present (see below) always print the id and the title before implementing. In the prompt that will be passed to claude or codex, please always clearly states the id of the element that we are solving. Add options --take-first: if we have more than one issue, simply write down which one you are going to implement and go. --limit x: to read more than 10 elements"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Single Issue Auto-Selection (Priority: P1)

A developer runs `automata implement-next` and only one issue matches the configured filter. The tool prints the issue ID and title before proceeding to implement it.

**Why this priority**: This is the most common single-issue workflow. The user needs visual confirmation of which issue is being claimed and implemented before AI invocation begins.

**Independent Test**: Run with a mocked single-issue response; verify that the issue number and title appear in stdout before the AI tool is invoked.

**Acceptance Scenarios**:

1. **Given** one issue matches the filter, **When** `implement-next` is run without flags, **Then** the tool prints the issue ID and title, then proceeds to claim and implement it.
2. **Given** one issue matches the filter, **When** `implement-next --query-only` is run, **Then** the tool prints full issue details including ID and title, then exits.

---

### User Story 2 - Multiple Issues: Interactive Selection (Priority: P1)

A developer runs `automata implement-next` and multiple issues match the filter. The tool displays the first 10 as a numbered list, optionally noting there are more, and waits for the user to type a number to select one.

**Why this priority**: Without selection, the tool silently picks the first issue. Presenting a choice prevents unintended work and aligns expectations.

**Independent Test**: Mock 12 issues; verify the tool lists numbers 1–10, states "showing first 10 of 12 ready issues", and prompts for input.

**Acceptance Scenarios**:

1. **Given** 5 issues match, **When** `implement-next` is run, **Then** the tool lists all 5 numbered and waits for the user to enter a number (1–5).
2. **Given** 15 issues match, **When** `implement-next` is run with default limit, **Then** the tool lists the first 10, states these are the first 10, and waits for the user to enter a number (1–10).
3. **Given** the user enters a valid number, **Then** the tool prints the selected issue ID and title, claims it, and invokes the AI.
4. **Given** the user enters an invalid number, **Then** the tool exits with an error message.

---

### User Story 3 - `--take-first` Flag (Priority: P2)

A developer runs `automata implement-next --take-first` when multiple issues match. The tool selects the first issue, prints which issue it chose, and immediately proceeds without prompting.

**Why this priority**: Supports non-interactive (scripted/CI) usage where pausing for user input is not possible.

**Independent Test**: Mock 5 issues, run with `--take-first`; verify no interactive prompt appears, the first issue ID and title are printed, and the AI is invoked.

**Acceptance Scenarios**:

1. **Given** multiple issues match and `--take-first` is set, **When** `implement-next --take-first` is run, **Then** the tool prints which issue it selected (ID + title) and proceeds without prompting.
2. **Given** one issue matches and `--take-first` is set, **When** `implement-next --take-first` is run, **Then** the tool behaves identically to the single-issue case (prints ID + title, proceeds).

---

### User Story 4 - `--limit` Flag (Priority: P2)

A developer runs `automata implement-next --limit 20` to fetch and display more than the default 10 issues before selecting.

**Why this priority**: The default cap of 10 is a convenience default, not a hard limit. Power users may want to see more options.

**Independent Test**: Mock 25 issues, run with `--limit 20`; verify 20 items are listed.

**Acceptance Scenarios**:

1. **Given** 25 issues match and `--limit 20` is set, **When** `implement-next --limit 20` is run, **Then** the tool fetches and displays up to 20 issues.
2. **Given** `--limit 5` is set, **When** 10 issues match, **Then** the tool fetches and displays up to 5 issues.

---

### User Story 5 - Issue ID in AI Prompt (Priority: P1)

Regardless of how an issue is selected, the prompt sent to Claude or Codex clearly identifies the issue being solved (e.g. "You are solving issue #42:").

**Why this priority**: The AI must know which issue it is working on to reference it correctly in commits and comments.

**Independent Test**: Capture the prompt passed to the AI tool; verify it contains the issue number.

**Acceptance Scenarios**:

1. **Given** issue #42 is selected, **When** the AI is invoked, **Then** the prompt contains "issue #42" (or equivalent identifier).
2. **Given** `--codex` flag is used, **Then** the Codex prompt also contains the issue number.

---

### Edge Cases

- What happens when the user enters `0` or a number greater than the list length? → Tool exits with a descriptive error on stderr and exit code 1.
- What happens when `--limit 0` or a negative limit is provided? → Tool exits with a validation error and exit code 1.
- What happens when no issues are found? → Existing "No issues found" message is unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When exactly one issue matches, the tool MUST print the issue ID and title before invoking any AI tool.
- **FR-002**: When multiple issues match, the tool MUST display a numbered list of up to N issues (default N=10) and wait for the user to select one by entering a number, unless `--take-first` is set.
- **FR-003**: When the total number of matching issues exceeds the display limit, the tool MUST state how many it is showing (e.g. "Showing first 10 ready issues").
- **FR-004**: The `--take-first` flag MUST cause the tool to select the first issue without prompting, printing the selected issue ID and title before proceeding.
- **FR-005**: The `--limit <n>` option MUST control how many issues are fetched and displayed (overrides the default of 10).
- **FR-006**: The prompt passed to any AI tool (Claude or Codex) MUST explicitly include the issue number being solved.
- **FR-007**: Invalid selection input (out-of-range number, non-numeric input) MUST cause the tool to exit with code 1 and a descriptive error message on stderr.
- **FR-008**: `--limit` MUST accept only positive integers; invalid values MUST cause the tool to exit with code 1.

### Key Entities

- **Issue**: A GitHub issue with a numeric identifier (number), title, body, and URL. The number is the primary identifier communicated to users and AI tools.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When multiple issues match, the user sees a numbered list and can select by typing a number — no additional commands required.
- **SC-002**: Every AI invocation includes the issue number in the prompt — verifiable by inspecting the spawned command arguments in tests.
- **SC-003**: `--take-first` completes without reading from stdin, making it safe for non-interactive (pipe/CI) contexts.
- **SC-004**: `--limit` correctly adjusts the number of issues fetched from GitHub — verifiable by inspecting the `--limit` argument passed to `gh issue list`.
- **SC-005**: All new behaviours are covered by unit tests that mock `gh` CLI output, achieving the same coverage standard as existing `getReady` tests.

## Assumptions

- [AUTO] Interactive prompt: uses `readline` from Node.js built-ins (no new dependency), consistent with project preference for Node.js built-ins.
- [AUTO] Default limit: 10, matching the user's stated default.
- [AUTO] Display format for multi-issue list: `  [N] #<number> - <title>` (numbered, compact, human-readable).
- [AUTO] Issue ID phrasing in AI prompt: prepend "Resolving issue #<number>:\n\n" before the system prompt + body.
- [AUTO] `--limit` parses as integer; non-numeric or ≤0 values cause immediate exit(1).
