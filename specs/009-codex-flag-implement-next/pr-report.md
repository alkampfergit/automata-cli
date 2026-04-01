# PR Report: Codex Flag for Implement-Next and Test Codex Command

**Branch**: `009-codex-flag-implement-next`
**Date**: 2026-04-01
**Spec**: [specs/009-codex-flag-implement-next/spec.md](./spec.md)

## Summary

Adds a `--codex` flag to `automata implement-next` that routes AI invocation to the OpenAI Codex CLI instead of Claude Code, using the same combined prompt (claudeSystemPrompt + issue body). A matching `test codex` subcommand mirrors `test claude` so developers can verify their Codex setup independently.

## What's New

- **`implement-next --codex`**: New flag that invokes `codex exec` with the same prompt used for Claude. Supports `--yolo` (maps to `--dangerously-bypass-approvals-and-sandbox`) and `--verbose` (JSONL progress streaming).
- **`test codex` subcommand**: Mirrors `test claude` — accepts `--prompt`, `--yolo`, and `--verbose`; invokes the Codex CLI directly for integration testing.
- **`src/codex/codexService.ts`**: New service module following the `src/claude/claudeService.ts` pattern, encapsulating all Codex CLI invocation logic (sync, verbose, error handling).

## Testing

- **Unit**: `tests/unit/codexService.test.ts` covers sync invocation args, yolo flag, ENOENT error, non-zero exit, and verbose mode event formatting.
- **Smoke (CLI)**: `tests/unit/test.cmd.test.ts` updated to verify `test codex` appears in help output.

## Notes

- Model selection flags (`--opus`, `--sonnet`, `--haiku`) are Claude-specific and do not apply to Codex invocations. Codex model selection uses a different config mechanism not in scope for this feature.
- `--no-claude` skips all AI invocation including Codex (semantically: "skip the AI step entirely").
