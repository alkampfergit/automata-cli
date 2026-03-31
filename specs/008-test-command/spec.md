# Feature Specification: Test Command Group

**Feature Branch**: `008-test-command`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "New command group `test` with a subcommand `test claude`. Purpose: testing whether the automata CLI can invoke Claude Code correctly."

## User Scenarios & Testing

### User Story 1 - Test Claude Code Invocation (Priority: P1)

A developer wants to verify that the automata CLI can successfully invoke Claude Code from the command line without needing to set up GitHub issues, configuration, or any other workflow dependencies. They run `automata test claude --prompt "say hello"` and observe Claude Code executing with that prompt.

**Why this priority**: This is the core and only user story. It provides a direct, zero-configuration way to test the Claude Code integration that powers the `implement-next` workflow.

**Independent Test**: Can be fully tested by running `automata test claude --prompt "echo hello"` and verifying Claude Code is spawned with the correct arguments. Delivers immediate feedback on whether the Claude Code integration works.

**Acceptance Scenarios**:

1. **Given** Claude Code is installed and on PATH, **When** the user runs `automata test claude --prompt "say hello"`, **Then** Claude Code is invoked with `-p "say hello"` and stdio is inherited so the user sees Claude's output.
2. **Given** Claude Code is installed and on PATH, **When** the user runs `automata test claude --prompt "say hello" --yolo`, **Then** Claude Code is invoked with `--dangerously-skip-permissions -p "say hello"`.
3. **Given** Claude Code is NOT installed, **When** the user runs `automata test claude --prompt "say hello"`, **Then** the CLI prints an error message to stderr and exits with code 1.
4. **Given** the user omits the `--prompt` option, **When** they run `automata test claude`, **Then** the CLI shows an error that `--prompt` is required and exits with a non-zero code.

---

### Edge Cases

- What happens when `--prompt` is provided with an empty string? The CLI should pass the empty string to Claude Code (let Claude handle it).
- What happens when Claude Code exits with a non-zero code? The CLI should propagate the exit code and print an error to stderr.

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide a `test` command group under the `automata` root command.
- **FR-002**: The `test` command group MUST have a `claude` subcommand.
- **FR-003**: The `claude` subcommand MUST accept a `--prompt <string>` option that is required.
- **FR-004**: The `claude` subcommand MUST accept an optional `--yolo` flag.
- **FR-005**: When `--yolo` is provided, the system MUST pass `--dangerously-skip-permissions` to the Claude Code CLI.
- **FR-006**: The system MUST resolve the `claude` binary from PATH using the same mechanism as `implement-next`.
- **FR-007**: The system MUST inherit stdio so the user sees Claude Code's output in real time.
- **FR-008**: The system MUST exit with a meaningful error if Claude Code is not found on PATH (exit code 1).
- **FR-009**: The system MUST propagate Claude Code's exit code on failure.

### Key Entities

- **TestCommand**: The command group (`automata test`) that serves as a container for test subcommands.
- **ClaudeSubcommand**: The `claude` subcommand that accepts `--prompt` and `--yolo` options and invokes Claude Code.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Running `automata test claude --prompt "hello"` successfully invokes Claude Code within 2 seconds of command execution.
- **SC-002**: The `--yolo` flag correctly passes `--dangerously-skip-permissions` to Claude Code 100% of the time.
- **SC-003**: When Claude Code is not on PATH, the user receives a clear error message and exit code 1.

## Assumptions

- [AUTO] No configuration needed: chose to skip config reading because the test command is intentionally zero-configuration to provide the simplest possible way to test Claude Code invocation.
- [AUTO] Reuse resolveCommand pattern: chose to extract and reuse the existing `resolveCommand` function from getReady.ts because it already handles PATH resolution correctly.
- [AUTO] No GitHub interaction: chose to skip all GitHub API calls because the purpose is purely to test Claude Code invocation in isolation.
- [AUTO] Command group structure: chose to use a command group (`test`) with subcommand (`claude`) to allow future test subcommands to be added under the same group.
