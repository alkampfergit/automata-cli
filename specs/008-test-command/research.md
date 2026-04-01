# Research: Test Command Group

**Branch**: `008-test-command` | **Date**: 2026-03-31

## Research Tasks

### 1. Existing Claude Code invocation pattern

**Finding**: `src/commands/getReady.ts` contains `resolveCommand()` (lines 8-15) and `invokeClaudeCode()` (lines 17-35). Both are private to that module.

**Decision**: Extract into shared service
**Rationale**: Both `implement-next` and `test claude` need the same invocation logic. Constitution principle III requires shared logic in service modules.
**Alternatives considered**: (1) Duplicate the functions in test.ts — violates DRY and Constitution III. (2) Import directly from getReady.ts — would require exporting implementation details from a command file.

### 2. Command group pattern

**Finding**: `src/commands/git.ts` and `src/commands/config.ts` both use the command group pattern: create a parent `Command`, add subcommands via `.addCommand()`.

**Decision**: Follow the same pattern for `test` command group
**Rationale**: Consistency with existing codebase.
**Alternatives considered**: Standalone `test-claude` command — less extensible, inconsistent with existing groups.

### 3. Required option pattern in commander.js

**Finding**: commander.js supports `.requiredOption()` which will automatically error if the option is not provided.

**Decision**: Use `.requiredOption("--prompt <string>", ...)` for the prompt option
**Rationale**: Built-in validation, consistent error messages, no custom code needed.
**Alternatives considered**: Manual validation with custom error — unnecessary complexity.

## Autonomous Decisions

- All research questions resolved from existing codebase analysis. No external research needed.
