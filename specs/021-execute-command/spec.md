# Feature Specification: Execute Command

**Feature Branch**: `021-execute-command`  
**Created**: 2026-04-03  
**Status**: Draft  
**Input**: User description: "Promote the test command to a real command called execute. The execute command receives a prompt from --prompt, --file-prompt (file on disk), or stdin. Remove --yolo (always unattended). Remove --verbose (on by default), add --silent (summary only). Add --model parameter for both claude and codex. Add mandatory --with parameter to choose executor (claude or codex). Remove the old test command."

## Assumptions

- [AUTO] Command name: `execute` (top-level command, not a subcommand) — matches user request literally
- [AUTO] Stdin detection: use `process.stdin.isTTY === false` to detect piped input — consistent with POSIX convention and existing Node.js patterns
- [AUTO] --with validation: strictly `claude` or `codex`; invalid value prints usage error and exits 1 — keeps UX consistent with commander.js patterns in this codebase
- [AUTO] --model for codex: pass via `--model` flag to `codex exec` — this is the codex CLI's documented flag
- [AUTO] Prompt sources are mutually exclusive: if more than one of `--prompt`, `--file-prompt`, stdin are provided simultaneously, error out — prevents ambiguous execution
- [AUTO] Verbose (non-silent) is the default: stream-json verbose output for Claude, plain output for Codex — consistent with the user's "verbose is on by default" instruction
- [AUTO] Remove `test` command entirely from index.ts — user explicitly asked for this
- [AUTO] `--file-prompt` reads file synchronously using `fs.readFileSync` — consistent with existing spawnSync pattern in the codebase

## User Scenarios & Testing

### User Story 1 - Inline prompt via --prompt (Priority: P1)

A developer wants to quickly delegate work to an AI by passing the prompt directly on the command line.

**Why this priority**: Core use case; all other input modes build on the same execution path.

**Independent Test**: `automata execute --with claude --prompt "say hello"` invokes Claude with the given prompt; `automata execute --with codex --prompt "say hello"` invokes Codex.

**Acceptance Scenarios**:

1. **Given** a valid executor and inline prompt, **When** `automata execute --with claude --prompt "do something"`, **Then** Claude Code is invoked unattended (dangerously-skip-permissions) with verbose output by default.
2. **Given** `--with codex --prompt "do something"`, **When** executed, **Then** Codex CLI is invoked with bypass-approvals flag and the prompt.
3. **Given** `--with unknown`, **When** executed, **Then** exits 1 with an error listing valid values.
4. **Given** no `--with`, **When** executed, **Then** commander reports it as required and exits with usage error.

---

### User Story 2 - Prompt from file via --file-prompt (Priority: P2)

A developer stores a reusable prompt in a markdown file and passes it to execute.

**Why this priority**: Common automation pattern; enables prompt reuse and version-controlled prompts.

**Independent Test**: `automata execute --with claude --file-prompt prompt.md` reads the file and passes its content as the prompt.

**Acceptance Scenarios**:

1. **Given** a readable file `prompt.md`, **When** `automata execute --with claude --file-prompt prompt.md`, **Then** file content is read and passed as the prompt to Claude.
2. **Given** a non-existent file, **When** `--file-prompt missing.md`, **Then** exits 1 with a clear error message.
3. **Given** both `--prompt` and `--file-prompt` provided, **When** executed, **Then** exits 1 with "mutually exclusive" error.

---

### User Story 3 - Prompt from stdin (Priority: P3)

A developer pipes a prompt from another command: `echo "fix lint errors" | automata execute --with codex`.

**Why this priority**: Enables pipeline composition — a core Unix philosophy requirement per constitution.

**Independent Test**: `echo "do something" | automata execute --with claude` reads stdin and passes it as the prompt.

**Acceptance Scenarios**:

1. **Given** stdin is piped (`process.stdin.isTTY === false`), **When** `echo "do something" | automata execute --with claude`, **Then** stdin content is read and used as the prompt.
2. **Given** stdin is a TTY and neither `--prompt` nor `--file-prompt` is given, **When** executed, **Then** exits 1 with "no prompt provided" error.
3. **Given** stdin provided alongside `--prompt`, **When** executed, **Then** exits 1 with mutually exclusive error.

---

### User Story 4 - Silent mode via --silent (Priority: P2)

A developer running in CI or a script wants minimal output: only the final summary.

**Why this priority**: Important for automation; replaces the removed --verbose flag.

**Independent Test**: `automata execute --with claude --prompt "..." --silent` produces only the final result line (no step-by-step progress).

**Acceptance Scenarios**:

1. **Given** `--silent` is set, **When** Claude is invoked, **Then** step-by-step streaming is suppressed; only final result is written to stdout.
2. **Given** no `--silent`, **When** Claude is invoked, **Then** verbose step-by-step progress is shown (current default behaviour).
3. **Given** `--silent` with Codex, **When** executed, **Then** Codex runs normally (silent flag is not applicable but does not error).

---

### User Story 5 - Model selection via --model (Priority: P3)

A developer specifies a model string directly: `automata execute --with claude --model claude-opus-4-6 --prompt "..."`.

**Why this priority**: Generalizes the existing `--opus/--sonnet/--haiku` shorthand flags into a single unified parameter.

**Independent Test**: `automata execute --with claude --model claude-opus-4-6 --prompt "test"` passes `--model claude-opus-4-6` to Claude; `automata execute --with codex --model o3 --prompt "test"` passes `--model o3` to Codex.

**Acceptance Scenarios**:

1. **Given** `--with claude --model claude-opus-4-6`, **When** executed, **Then** `--model claude-opus-4-6` is forwarded to the Claude CLI.
2. **Given** `--with codex --model o3`, **When** executed, **Then** `--model o3` is forwarded to the Codex CLI.
3. **Given** no `--model`, **When** executed, **Then** each executor uses its own default model.

---

### Edge Cases

- What happens when the prompt file is empty? → Pass empty string; let the AI handle it.
- What happens when stdin read times out? → No special timeout; rely on process stream close event.
- What if both `--file-prompt` and stdin are piped simultaneously? → `--file-prompt` takes priority; stdin is ignored (mutual exclusivity check: only error when `--prompt` is combined with another source).
- What if `--model` receives an empty string? → Pass it through; let the underlying CLI report the error.

## Requirements

### Functional Requirements

- **FR-001**: The CLI MUST expose a top-level `execute` command that replaces the `test` command.
- **FR-002**: `execute` MUST accept a prompt from exactly one of: `--prompt <string>`, `--file-prompt <path>`, or stdin.
- **FR-003**: `execute` MUST require `--with <executor>` where executor is `claude` or `codex`; invalid values MUST exit 1.
- **FR-004**: `execute` MUST always invoke the chosen executor in unattended mode (no `--yolo` flag needed).
- **FR-005**: By default (without `--silent`), `execute` MUST show verbose step-by-step output when using Claude.
- **FR-006**: `--silent` flag MUST suppress step-by-step progress and show only the final summary.
- **FR-007**: `--model <string>` MUST forward the model string to the underlying executor CLI (both Claude and Codex).
- **FR-008**: The old `test` command (and its `claude`/`codex` subcommands) MUST be removed from the CLI.
- **FR-009**: If no prompt source is provided (no `--prompt`, no `--file-prompt`, not piped stdin), the command MUST exit 1 with a clear error.
- **FR-010**: If multiple prompt sources are provided simultaneously, the command MUST exit 1 with a "mutually exclusive" error.

### Key Entities

- **ExecuteOptions**: `{ with: string; prompt?: string; filePrompt?: string; model?: string; silent?: boolean }`
- **Prompt source**: resolved string passed to the selected executor service

## Success Criteria

### Measurable Outcomes

- **SC-001**: All five user stories pass their acceptance scenarios with manual testing.
- **SC-002**: `npm test && npm run lint` passes with zero failures after implementation.
- **SC-003**: `automata execute --help` shows the new command with all options documented.
- **SC-004**: The old `test` command no longer appears in `automata --help`.
- **SC-005**: Existing `execute-prompt sonar` and `execute-prompt fix-comments` commands are unaffected.
