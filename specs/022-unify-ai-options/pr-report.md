# PR Report: Unify implement-next AI options

**Branch**: `022-unify-ai-options`
**Date**: 2026-04-08
**Spec**: [specs/022-unify-ai-options/spec.md](specs/022-unify-ai-options/spec.md)

## Summary

Unifies the `implement-next` command's AI configuration options with the `execute` command's interface. Replaces `--codex`/`--opus`/`--sonnet`/`--haiku`/`--verbose` flags with `--with <executor>`, `--model <string>`, and `--silent`, making both commands consistent in how they select and configure AI executors.

## What's New

- **Command options**: Replaced 5 flags (`--codex`, `--opus`, `--sonnet`, `--haiku`, `--verbose`) with 3 unified options (`--with <executor>`, `--model <string>`, `--silent`) matching the `execute` command's interface
- **Default behavior**: Verbose output is now the default (previously opt-in via `--verbose`); use `--silent` to suppress it
- **Executor selection**: `--with claude` (default) or `--with codex` replaces the `--codex` boolean flag, with validation for invalid values
- **Model selection**: `--model <string>` accepts any model identifier directly, replacing the fixed `--opus`/`--sonnet`/`--haiku` shortcuts

## Breaking Changes

- **`--codex` removed**: Use `--with codex` instead of `--codex`
- **`--opus`/`--sonnet`/`--haiku` removed**: Use `--model claude-opus-4-6`, `--model claude-sonnet-4-6`, or `--model claude-haiku-4-5-20251001` instead
- **`--verbose` removed**: Verbose is now the default. Use `--silent` to suppress output

## Testing

- **Unit**: Updated CLI smoke test to verify new options appear and old options are absent
- **Unit**: Updated Claude/Codex invocation tests to use `--with codex` and `--silent`
- **Unit**: All 234 existing tests pass with zero failures

## Notes

- `resolveModelOption` and `MODEL_IDS` remain in `claudeService.ts` because `executePrompt.ts` still uses them
- `--no-claude` flag retained as-is (renaming out of scope)
