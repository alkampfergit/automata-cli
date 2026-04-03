# PR Report: Execute Command

**Branch**: `021-execute-command`
**Date**: 2026-04-03
**Spec**: specs/021-execute-command/spec.md

## Summary

This feature promotes the experimental `test` command to a production-grade `execute` command. It accepts a prompt from `--prompt`, `--file-prompt`, or stdin; requires `--with claude|codex` to select the executor; and defaults to verbose output with an optional `--silent` flag for minimal output. The old `test` command is removed entirely.

## What's New

<!-- To be completed after implementation -->

- **`execute` command**: [placeholder]
- **Codex model support**: [placeholder]
- **Stdin prompt source**: [placeholder]

## Testing

<!-- To be completed after implementation -->

- **Unit**: [placeholder]
- **Manual**: [placeholder]

## Breaking Changes

- **`test` command removed**: The `automata test claude` and `automata test codex` subcommands are replaced by `automata execute --with claude/codex`. Users must update any scripts that used `automata test`.

## Notes

<!-- To be completed if needed -->
