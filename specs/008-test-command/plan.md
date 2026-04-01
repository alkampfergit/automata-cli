# Implementation Plan: Test Command Group

**Branch**: `008-test-command` | **Date**: 2026-03-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-test-command/spec.md`

## Summary

Add a `test` command group with a `claude` subcommand that directly invokes Claude Code with a user-supplied prompt. This provides a zero-configuration way to verify the Claude Code integration works without needing GitHub issues or config setup. Reuses the existing `resolveCommand` + `spawnSync` pattern from `implement-next`.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: commander.js (existing), node:child_process (existing)
**Storage**: N/A
**Testing**: vitest (existing)
**Target Platform**: Node.js LTS (18+)
**Project Type**: CLI
**Performance Goals**: N/A — spawns external process
**Constraints**: None beyond existing project constraints
**Scale/Scope**: Single command group with one subcommand

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CLI-First Design | PASS | New commander.js command with clear options, stderr for errors, exit codes |
| II. TypeScript Strictness | PASS | Will use strict types, no `any` |
| III. Single Responsibility | PASS | `test claude` does one thing: invoke Claude Code with a prompt |
| IV. npm Distribution | PASS | No new runtime dependencies |
| V. Simplicity | PASS | Minimal implementation reusing existing patterns |

No violations. No complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/008-test-command/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── spec.md              # Feature specification
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── commands/
│   └── test.ts          # New: test command group with claude subcommand
├── services/
│   └── claudeService.ts # New: extracted resolveCommand + invokeClaudeCode
└── index.ts             # Modified: register testCommand

tests/
└── unit/
    └── test.cmd.test.ts # New: unit tests for test command
```

**Structure Decision**: Follows existing flat command structure (one file per command group in `src/commands/`). Extract shared Claude Code invocation logic into `src/services/claudeService.ts` so both `implement-next` and `test claude` can reuse it without duplication, per Constitution principle III (shared logic in service modules).

## Architecture

### Shared Service Extraction

The `resolveCommand` and `invokeClaudeCode` functions currently live in `src/commands/getReady.ts`. Per Constitution principle III, shared logic should be in service modules. Extract these into `src/services/claudeService.ts`:

- `resolveCommand(name: string): string` — unchanged
- `invokeClaudeCode(prompt: string, yolo: boolean): void` — simplified signature (takes prompt string directly instead of GitHubIssue)

Update `getReady.ts` to import from the new service (compose the prompt from issue body + system prompt, then call the service).

### Command Structure

```
automata test              # Shows help for test group
automata test claude       # Error: --prompt is required
automata test claude --prompt "hello"        # Invokes claude -p "hello"
automata test claude --prompt "hello" --yolo # Invokes claude --dangerously-skip-permissions -p "hello"
```
