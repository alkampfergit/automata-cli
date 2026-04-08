# Feature Specification: Normalize Execute-Prompt Parameters

**Feature Branch**: `feature/028-normalize-execute-prompt`  
**Created**: 2026-04-08  
**Status**: Draft  
**Input**: User description: "Actually the execute-prompt has a lot of options and most related to models and tools are too complex. fix both the execute-prompt sonar and fix-comments. Use the same options you have on execute command to manage claude/codex and also model."

## Assumptions

- [AUTO] Executor selection uses `--with <executor>` and accepts only `claude` or `codex` because `execute` already uses that contract and the issue explicitly asks to reuse it.
- [AUTO] Model selection uses a free-form `--model <string>` for both executors because the issue explicitly asks to remove executor-specific model shortcuts in favor of the `execute` command pattern.
- [AUTO] Claude output behavior also aligns with `execute`: verbose by default, `--silent` to suppress step-by-step output. This keeps the AI-facing option set consistent across commands instead of leaving `execute-prompt` with a separate verbosity model.
- [AUTO] `--push` remains supported because it is workflow-specific to `execute-prompt`, not an executor/model selection shortcut.
- [AUTO] Legacy flags `--codex`, `--opus`, `--sonnet`, `--haiku`, and `--verbose` are removed from `execute-prompt` help and behavior because they duplicate or conflict with the normalized interface.

## Clarifications

- Q: Should `execute-prompt` keep defaulting to Claude when no executor flag is passed, or should it match `execute` and require `--with`? → A: Require `--with` for both `sonar` and `fix-comments` [AUTO: matching `execute` exactly removes hidden defaults and makes the interface predictable].
- Q: Should verbosity remain `--verbose`, or should it match `execute` and use `--silent`? → A: Use `--silent` [AUTO: the issue asks to use the same options as `execute`, and `execute` already treats verbose output as the default].

## User Scenarios & Testing

### User Story 1 - Choose the executor consistently (Priority: P1)

A developer runs `automata execute-prompt sonar` or `automata execute-prompt fix-comments` and wants executor selection to work the same way as `automata execute`, without remembering legacy `--codex` or Claude-only shortcuts.

**Why this priority**: This is the core requested behavior and the main source of current CLI inconsistency.

**Independent Test**: Run each subcommand with `--with claude` and `--with codex` and verify the correct executor service is invoked; omit `--with` and verify commander reports it as required.

**Acceptance Scenarios**:

1. **Given** `automata execute-prompt sonar --with claude`, **When** the command builds the prompt, **Then** Claude is invoked with unattended mode enabled.
2. **Given** `automata execute-prompt fix-comments --with codex`, **When** the command builds the prompt, **Then** Codex is invoked with unattended mode enabled.
3. **Given** `automata execute-prompt sonar` without `--with`, **When** executed, **Then** commander exits with a usage error because the executor is required.
4. **Given** `automata execute-prompt fix-comments --with unknown`, **When** executed, **Then** the command exits 1 with a clear validation error listing valid executors.

---

### User Story 2 - Pass a model string directly (Priority: P2)

A developer wants to choose a model explicitly for either Claude or Codex by using the same `--model` option used by `automata execute`.

**Why this priority**: The issue explicitly asks to replace executor-specific model flags with the normalized `--model` contract.

**Independent Test**: Run `sonar` and `fix-comments` with `--model <value>` for both executors and verify the string is forwarded to the underlying service invocation.

**Acceptance Scenarios**:

1. **Given** `automata execute-prompt sonar --with claude --model claude-opus-4-6`, **When** executed, **Then** Claude receives `model: "claude-opus-4-6"`.
2. **Given** `automata execute-prompt fix-comments --with codex --model o3`, **When** executed, **Then** Codex receives `model: "o3"`.
3. **Given** no `--model`, **When** either subcommand is executed, **Then** the executor uses its default model.

---

### User Story 3 - Keep prompt workflows but simplify executor flags (Priority: P2)

A developer still wants `sonar` and `fix-comments` to preserve their current prompt-building behavior, including `--push`, while removing the clutter of old executor-specific flags.

**Why this priority**: The feature should simplify invocation without regressing the existing automation workflows.

**Independent Test**: Run each subcommand with `--push` and `--silent` and verify that the composed prompt still includes the push instruction while Claude verbosity follows the `execute` command pattern.

**Acceptance Scenarios**:

1. **Given** `automata execute-prompt sonar --with claude --silent`, **When** executed, **Then** Claude is invoked with `verbose: false`.
2. **Given** `automata execute-prompt fix-comments --with claude` without `--silent`, **When** executed, **Then** Claude is invoked with verbose output enabled by default.
3. **Given** `automata execute-prompt sonar --with codex --push`, **When** executed, **Then** the prompt still includes the existing commit-and-push instruction.
4. **Given** `automata execute-prompt sonar --help` or `fix-comments --help`, **When** shown, **Then** legacy flags `--codex`, `--opus`, `--sonnet`, `--haiku`, and `--verbose` are absent.

### Edge Cases

- What happens when `--silent` is passed with `--with codex`? The command accepts it for consistency and Codex ignores the verbosity setting, matching `execute`.
- What happens when a user still passes removed flags such as `--codex`? Commander should reject them as unknown options.
- What happens when `--model` is an invalid model name? The string is forwarded and the underlying executor CLI is allowed to report the model error.

## Requirements

### Functional Requirements

- **FR-001**: `automata execute-prompt sonar` MUST require `--with <executor>` where executor is `claude` or `codex`.
- **FR-002**: `automata execute-prompt fix-comments` MUST require `--with <executor>` where executor is `claude` or `codex`.
- **FR-003**: Both `execute-prompt` subcommands MUST accept `--model <string>` and forward that value to the selected executor service.
- **FR-004**: Both `execute-prompt` subcommands MUST remove legacy executor/model shortcut flags `--codex`, `--opus`, `--sonnet`, and `--haiku`.
- **FR-005**: Claude verbosity for both `execute-prompt` subcommands MUST match `execute`: verbose by default and suppressed by `--silent`.
- **FR-006**: Both `execute-prompt` subcommands MUST preserve the existing `--push` behavior.
- **FR-007**: Prompt construction for Sonar and Fix-Comments MUST remain unchanged apart from the normalized executor/model option handling.
- **FR-008**: Documentation for `execute-prompt` MUST describe the new normalized options and remove references to the legacy flags.
- **FR-009**: Existing unit coverage for `execute-prompt sonar` and `execute-prompt fix-comments` MUST be updated to validate the new interface.

### Key Entities

- **ExecutePromptAiOptions**: CLI option object for `execute-prompt` subcommands containing `with`, `model`, `silent`, and `push`.
- **Executor selection**: validation step that maps `--with claude|codex` to the existing Claude or Codex service invocation.

## Success Criteria

### Measurable Outcomes

- **SC-001**: `automata execute-prompt sonar --help` and `automata execute-prompt fix-comments --help` show `--with`, `--model`, `--silent`, and `--push`, and no longer show `--codex`, `--opus`, `--sonnet`, `--haiku`, or `--verbose`.
- **SC-002**: Unit tests cover executor selection, model forwarding, and default/silent Claude verbosity for both `sonar` and `fix-comments`.
- **SC-003**: `npm test && npm run lint` passes after implementation.
