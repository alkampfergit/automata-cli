# PR Report: Test Command Group

**Branch**: `008-test-command`
**Date**: 2026-03-31
**Spec**: [specs/008-test-command/spec.md](spec.md)

## Summary

Adds a new `test` command group with a `claude` subcommand that directly invokes Claude Code with a user-supplied prompt. This provides a zero-configuration way to verify that the automata CLI can successfully call Claude Code, without needing GitHub issues or config setup.

## What's New

- **Claude service extraction** (`src/claude/claudeService.ts`): Extracted `resolveCommand` and `invokeClaudeCode` from `getReady.ts` into a shared service module. Both `implement-next` and `test claude` now use this shared module.
- **Test command group** (`src/commands/test.ts`): New `automata test` command group with a `claude` subcommand. Accepts `--prompt <string>` (required) and `--yolo` (optional) flags.
- **Command registration** (`src/index.ts`): Added `testCommand` to the CLI root.
- **Documentation** (`docs/test.md`): Full command reference for the test group.

## Testing

- **Unit**: `claudeService.test.ts` — tests invocation args (normal and yolo mode), ENOENT handling, and exit code propagation.
- **Unit (smoke)**: `test.cmd.test.ts` — CLI smoke tests verifying help output, option listing, and top-level registration.
- **Regression**: All 131 existing tests pass, confirming the `getReady.ts` refactor is backward-compatible.
