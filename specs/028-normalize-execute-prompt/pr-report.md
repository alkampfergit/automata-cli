# PR Report: Normalize Execute-Prompt Parameters

**Branch**: `feature/028-normalize-execute-prompt`
**Date**: 2026-04-08
**Spec**: specs/028-normalize-execute-prompt/spec.md

## Summary

This feature simplifies `execute-prompt sonar` and `execute-prompt fix-comments` by aligning their AI executor options with the existing `execute` command. Instead of a mix of executor-specific flags, both subcommands now use the same `--with`, `--model`, and `--silent` interface while preserving the existing prompt workflows.

## What's New

- **`execute-prompt` option model**: Both `sonar` and `fix-comments` now require `--with <claude|codex>` and accept `--model <string>`, matching the top-level `execute` command instead of exposing executor-specific shortcuts.
- **Claude output behavior**: Both subcommands now default to verbose Claude execution and use `--silent` to suppress step-by-step output, again matching `execute`.
- **Prompt workflows preserved**: Existing Sonar and Fix-Comments prompt assembly, including `--push`, remain intact while the executor dispatch logic is simplified.
- **Docs and tests**: Updated `docs/execute-prompt.md`, added a brief README entry, and refreshed unit coverage for the normalized interface and error paths.

## Breaking Changes

- **Legacy `execute-prompt` flags removed**: `--codex`, `--verbose`, `--opus`, `--sonnet`, and `--haiku` no longer exist on `execute-prompt sonar` or `execute-prompt fix-comments`. Use `--with codex`, `--model <string>`, and `--silent` instead.

## Testing

- **Unit**: `tests/unit/executePrompt.cmd.test.ts` covers `sonar` executor selection, `--model` forwarding, default/silent Claude verbosity, prompt composition, and invalid/missing `--with` handling.
- **Unit**: `tests/unit/executePromptFixComments.cmd.test.ts` covers the same normalized AI option behavior for `fix-comments`, plus the existing no-comments / no-PR / unsupported-remote error flows.
- **Manual**: Verified `node dist/index.js execute-prompt sonar --help` and `node dist/index.js execute-prompt fix-comments --help` show only `--with`, `--model`, `--silent`, `--push`, and `--help`.
