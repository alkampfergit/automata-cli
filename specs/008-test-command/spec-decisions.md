# Spec Decisions: Test Command Group

**Branch**: `008-test-command`
**Date**: 2026-03-31
**Spec**: [specs/008-test-command/spec.md](spec.md)
**Plan**: [specs/008-test-command/plan.md](plan.md)
**Research**: [specs/008-test-command/research.md](research.md)

## Planning Decisions

- **Shared service extraction**: Extract `resolveCommand` and `invokeClaudeCode` into `src/services/claudeService.ts`. **Rationale**: Both `implement-next` and `test claude` need the same invocation logic; Constitution principle III requires shared logic in service modules. **Alternatives considered**: Duplicating functions in test.ts (violates DRY), exporting from getReady.ts (leaks command-level implementation details).

- **Command group pattern**: Use a `test` command group with `claude` as a subcommand. **Rationale**: Consistent with existing `git` and `config` command groups; allows future test subcommands. **Alternatives considered**: Standalone `test-claude` command (less extensible, inconsistent).

- **Required option via commander.js**: Use `.requiredOption("--prompt <string>", ...)` for the prompt. **Rationale**: Built-in validation, consistent error messages, zero custom code. **Alternatives considered**: Manual validation with custom error (unnecessary complexity).
