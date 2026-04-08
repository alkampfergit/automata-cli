# Feature Specification: Unify implement-next AI options with execute command

**Feature Branch**: `022-unify-ai-options`  
**Created**: 2026-04-08  
**Status**: Draft  
**Input**: User description: "Replace --codex, --opus, --sonnet, --haiku flags in implement-next with --with and --model options to match the execute command's interface for AI executor and model selection."

## Assumptions

- [AUTO] Backward compatibility: Not preserving deprecated flags. The old flags (--codex, --opus, --sonnet, --haiku) will be removed entirely because this is an internal CLI tool with a small user base and keeping deprecated aliases adds maintenance burden.
- [AUTO] --no-claude flag: Retained as-is. Renaming to --no-ai is out of scope for this change; the flag works regardless of executor and changing it would break the existing negation pattern.
- [AUTO] --silent/--verbose swap: The execute command uses --silent (opt-in silence). implement-next currently uses --verbose (opt-in verbosity). We will replace --verbose with --silent to match execute's interface, making verbose the default.
- [AUTO] --yolo flag: Retained as-is since both commands already share this behavior and it is not part of the --with/--model unification.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select AI executor via --with flag (Priority: P1)

A developer runs `automata implement-next --with claude` or `automata implement-next --with codex` to choose which AI tool implements the claimed issue, using the same `--with <executor>` option pattern as the `execute` command.

**Why this priority**: This is the core change — replacing `--codex` boolean flag with `--with <executor>` brings implement-next in line with execute's interface and enables future executor extensibility.

**Independent Test**: Can be tested by running `automata implement-next --with codex` with a mocked environment and verifying the correct executor binary is invoked.

**Acceptance Scenarios**:

1. **Given** a configured repository with matching issues, **When** the user runs `automata implement-next --with codex`, **Then** the system claims the issue and invokes `codex exec` with the prompt.
2. **Given** a configured repository with matching issues, **When** the user runs `automata implement-next --with claude`, **Then** the system claims the issue and invokes `claude -p` with the prompt.
3. **Given** the user runs `automata implement-next` without `--with`, **Then** the system defaults to `claude` as the executor (same as current default behavior).
4. **Given** the user runs `automata implement-next --with invalid`, **Then** the system prints an error: `--with must be 'claude' or 'codex'` and exits with code 1.

---

### User Story 2 - Select model via --model flag (Priority: P2)

A developer runs `automata implement-next --model claude-sonnet-4-6` to specify which model to pass to the AI executor, replacing the `--opus`, `--sonnet`, and `--haiku` shortcut flags.

**Why this priority**: Model selection is secondary to executor selection but is needed to complete the interface unification.

**Independent Test**: Can be tested by running `automata implement-next --model claude-sonnet-4-6` and verifying the model argument is passed to the invoked executor.

**Acceptance Scenarios**:

1. **Given** a configured repository, **When** the user runs `automata implement-next --model claude-opus-4-6`, **Then** the system passes `--model claude-opus-4-6` to the invoked executor.
2. **Given** a configured repository, **When** the user runs `automata implement-next --model` without a value, **Then** commander reports a missing argument error.
3. **Given** the user runs `automata implement-next` without `--model`, **Then** no model flag is passed to the executor (uses the executor's default).

---

### User Story 3 - Suppress verbose output via --silent (Priority: P3)

A developer runs `automata implement-next --silent` to suppress step-by-step Claude output and show only the final summary, matching the `execute` command's `--silent` flag instead of the current `--verbose` opt-in pattern.

**Why this priority**: This is a minor interface alignment change that improves consistency between the two commands.

**Independent Test**: Can be tested by running `automata implement-next --silent` and verifying that verbose streaming is suppressed.

**Acceptance Scenarios**:

1. **Given** a configured repository, **When** the user runs `automata implement-next --silent`, **Then** Claude Code is invoked without `--verbose` and only the final result is shown.
2. **Given** a configured repository, **When** the user runs `automata implement-next` without `--silent`, **Then** Claude Code is invoked with verbose output (step-by-step progress) as the new default.

---

### Edge Cases

- What happens when `--with` and `--no-claude` are combined? `--no-claude` takes precedence and skips all AI invocation regardless of `--with`.
- What happens when `--model` is used with `--no-claude`? The model flag is ignored since no AI executor is launched.
- What happens when `--with codex` and `--silent` are combined? A warning is printed that `--silent` is not supported for Codex (matching existing Codex behavior with `--verbose`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `implement-next` command MUST accept `--with <executor>` to select the AI executor (`claude` or `codex`).
- **FR-002**: The `implement-next` command MUST default to `claude` when `--with` is not specified.
- **FR-003**: The `implement-next` command MUST accept `--model <string>` to pass a model identifier to the selected executor.
- **FR-004**: The `implement-next` command MUST remove the `--codex`, `--opus`, `--sonnet`, and `--haiku` flags.
- **FR-005**: The `implement-next` command MUST replace `--verbose` with `--silent` to match the execute command's interface.
- **FR-006**: When `--silent` is not provided, the command MUST default to verbose output (showing step-by-step progress).
- **FR-007**: When `--silent` is provided, the command MUST suppress step-by-step output and show only the final summary.
- **FR-008**: The `implement-next` command MUST validate that `--with` values are either `claude` or `codex`, exiting with code 1 and an error message for invalid values.
- **FR-009**: The `--no-claude` flag MUST continue to skip all AI invocation regardless of `--with` value.
- **FR-010**: Documentation in `docs/implement-next.md` MUST be updated to reflect the new options.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running `automata implement-next --help` shows `--with`, `--model`, and `--silent` options and does NOT show `--codex`, `--opus`, `--sonnet`, `--haiku`, or `--verbose`.
- **SC-002**: All existing tests pass after updating to the new option interface.
- **SC-003**: The execute and implement-next commands share the same `--with`, `--model`, and `--silent` option patterns for AI executor configuration.
- **SC-004**: `npm test && npm run lint` passes with zero errors.
