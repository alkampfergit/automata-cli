# PR Report: Unify implement-next AI options

**Branch**: `022-unify-ai-options`
**Date**: 2026-04-08
**Spec**: [specs/022-unify-ai-options/spec.md](specs/022-unify-ai-options/spec.md)

## Summary

Unifies the `implement-next` command's AI configuration options with the `execute` command's interface. Replaces `--codex`/`--opus`/`--sonnet`/`--haiku`/`--verbose` flags with `--with <executor>`, `--model <string>`, and `--silent`, making both commands consistent in how they select and configure AI executors.

## What's New

[To be completed after implementation]

## Breaking Changes

- **`--codex` removed**: Use `--with codex` instead of `--codex`
- **`--opus`/`--sonnet`/`--haiku` removed**: Use `--model claude-opus-4-6`, `--model claude-sonnet-4-6`, or `--model claude-haiku-4-5-20251001` instead
- **`--verbose` removed**: Verbose is now the default. Use `--silent` to suppress output

## Testing

[To be completed after implementation]

## Notes

[To be completed after implementation]
