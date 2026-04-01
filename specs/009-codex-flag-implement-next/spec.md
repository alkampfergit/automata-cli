# Feature Specification: Codex Flag for Implement-Next and Test Codex Command

**Feature Branch**: `009-codex-flag-implement-next`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "Add --codex flag to implement-next and test codex command. By default implement-next uses Claude, but a new --codex flag should allow implementing with Codex instead. The --yolo option for Codex corresponds to --dangerously-bypass-approvals-and-sandbox. The --verbose flag should show progress like Claude does. Add a `test codex` subcommand mirroring `test claude`. Both Claude and Codex invocations use the same prompt configured for Claude (claudeSystemPrompt from config)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use Codex for Issue Implementation (Priority: P1)

A developer wants to use Codex (OpenAI's Codex CLI) instead of Claude Code to implement the next open GitHub issue. They run `automata implement-next --codex` and the tool claims the issue, constructs the prompt from the configured system prompt and issue body, then invokes the Codex CLI.

**Why this priority**: This is the core new capability. Without this, the feature has no value.

**Independent Test**: Can be fully tested by running `automata implement-next --codex` with a mocked Codex CLI and verifying the correct arguments and prompt are passed.

**Acceptance Scenarios**:

1. **Given** a valid config with `claudeSystemPrompt` set, **When** the user runs `automata implement-next --codex`, **Then** the Codex CLI is invoked with the system prompt and issue body as the prompt (same combined prompt as Claude).
2. **Given** `automata implement-next` runs without `--codex`, **When** the action executes, **Then** the Claude CLI is invoked as before (default behavior unchanged).
3. **Given** the user runs `automata implement-next --codex --yolo`, **When** the action executes, **Then** the Codex CLI is invoked with `--dangerously-bypass-approvals-and-sandbox`.
4. **Given** the user runs `automata implement-next --codex --verbose`, **When** the action executes, **Then** progress output is shown, mirroring Claude's verbose mode.

---

### User Story 2 - Test Codex Invocation Directly (Priority: P2)

A developer wants to verify their Codex CLI setup by running a test prompt directly. They run `automata test codex --prompt "Hello world"` and the tool invokes the Codex CLI with that prompt.

**Why this priority**: Mirrors the existing `test claude` subcommand and provides a way to verify the Codex integration works independently.

**Independent Test**: Can be fully tested by running `automata test codex --prompt "Hello"` with a mocked Codex CLI and verifying the invocation arguments.

**Acceptance Scenarios**:

1. **Given** the Codex CLI is installed, **When** the user runs `automata test codex --prompt "test prompt"`, **Then** the Codex CLI is invoked with the given prompt.
2. **Given** the user runs `automata test codex --prompt "test" --yolo`, **When** the action executes, **Then** the Codex CLI is invoked with `--dangerously-bypass-approvals-and-sandbox`.
3. **Given** the user runs `automata test codex --prompt "test" --verbose`, **When** the action executes, **Then** progress output is shown.

---

### Edge Cases

- What happens when both `--codex` and `--no-claude` are specified? Both flags would be redundant — `--no-claude` skips AI invocation entirely.
- What happens when the Codex CLI is not installed or not on PATH? The tool should give a clear error message (mirroring Claude's ENOENT handling).
- What happens when `--codex` is combined with `--opus`/`--sonnet`/`--haiku`? Model flags are Claude-specific and should not apply to Codex invocations; they should be ignored or produce a warning.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `implement-next` command MUST accept a `--codex` flag that routes invocation to the Codex CLI instead of Claude Code.
- **FR-002**: When `--codex` is specified, the Codex CLI MUST be invoked with the same combined prompt (claudeSystemPrompt + issue body) used by Claude.
- **FR-003**: When `--codex --yolo` is specified, the Codex CLI MUST be invoked with `--dangerously-bypass-approvals-and-sandbox`.
- **FR-004**: When `--codex --verbose` is specified, progress output MUST be shown in a similar manner to Claude's verbose mode.
- **FR-005**: The default behavior of `implement-next` (Claude invocation) MUST remain unchanged when `--codex` is not specified.
- **FR-006**: A new `test codex` subcommand MUST be available, mirroring the interface of `test claude`.
- **FR-007**: The `test codex` subcommand MUST accept `--prompt`, `--yolo`, and `--verbose` options.
- **FR-008**: When the Codex CLI is not found on PATH, the tool MUST output a clear error and exit with a non-zero code.

### Key Entities

- **CodexService**: A new service (or extension of the existing claude service module) responsible for Codex CLI invocation, analogous to `claudeService.ts`.
- **InvokeCodexOptions**: Interface defining options for Codex invocation (`yolo`, `verbose`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can run `automata implement-next --codex` and the Codex CLI is invoked with the correct prompt within the same time as the equivalent Claude invocation.
- **SC-002**: All existing `implement-next` behavior without `--codex` is unaffected (zero regressions in existing tests).
- **SC-003**: `automata test codex --prompt "..."` successfully invokes the Codex CLI, verified by unit tests.
- **SC-004**: Clear error messages are produced when Codex CLI is not installed.
- **SC-005**: The `--verbose` flag for Codex produces human-readable progress output.

## Assumptions

- [AUTO] Codex CLI binary name: chose `codex` as the binary name on PATH, because the OpenAI Codex CLI is conventionally named `codex`, mirroring how Claude Code uses `claude`.
- [AUTO] Model flags for Codex: chose to not expose `--model` flags for Codex in this iteration, because Codex CLI model selection differs from Claude and was not mentioned in the feature description. Scope is minimal.
- [AUTO] Verbose mode for Codex: chose to implement verbose mode by showing stdout/stderr lines prefixed with progress indicators, since Codex CLI does not use the same stream-json format as Claude; simpler line-by-line output is appropriate.
- [AUTO] `--codex` and `--no-claude` interaction: chose to treat `--no-claude` as skipping all AI invocation (including Codex), because `--no-claude` semantically means "skip AI step entirely".
- [AUTO] Prompt construction: chose to reuse the same `claudeSystemPrompt` config field for Codex prompts, per the explicit feature description stating "Both Claude and Codex invocations use the same prompt configured for Claude".
