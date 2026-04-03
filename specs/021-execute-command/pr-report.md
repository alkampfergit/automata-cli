# PR Report: Execute Command

**Branch**: `021-execute-command`
**Date**: 2026-04-03
**Spec**: specs/021-execute-command/spec.md

## Summary

This feature promotes the experimental `test` command to a production-grade top-level `execute` command. It accepts a prompt from `--prompt`, `--file-prompt <path>`, or piped stdin; requires `--with claude|codex` to select the executor; runs always unattended; defaults to verbose streaming output; and supports `--silent` for summary-only output and `--model` for executor model selection. The old `test` command is removed entirely.

## What's New

- **`execute` command** (`src/commands/execute.ts`): New top-level command with `--with <executor>`, `--prompt`, `--file-prompt`, `--silent`, and `--model` options. Replaces `automata test claude` / `automata test codex`.
- **Multi-source prompt resolution**: Prompt is read from `--prompt` (inline), `--file-prompt` (file on disk), or piped stdin, with mutual exclusivity enforced.
- **Verbose by default / `--silent` to suppress**: Step-by-step progress is shown by default; `--silent` limits output to the final summary only.
- **`--model` forwarding**: The model string is forwarded to both Claude (`--model`) and Codex (`--model`) executors. `codexService` updated to accept and forward the new option.
- **Removed `test` command**: `src/commands/test.ts`, `docs/test.md`, and `tests/unit/test.cmd.test.ts` deleted; `src/index.ts` updated accordingly.
- **Documentation**: Added `docs/execute.md` with full reference; `README.md` updated with an `execute` section.

## Breaking Changes

- **`test` command removed**: `automata test claude` and `automata test codex` no longer exist. Replace with `automata execute --with claude` / `automata execute --with codex`. The `--yolo` flag is gone (unattended mode is now always on). The `--verbose` flag is gone (verbose is now the default; use `--silent` to suppress).

## Testing

- **Unit (CLI smoke)**: `tests/unit/execute.cmd.test.ts` — verifies `--with` validation, missing prompt source, `--file-prompt` for non-existent file, mutual exclusivity of `--prompt` + `--file-prompt`, and correct help output.
- **Unit (service)**: `tests/unit/codexService.test.ts` — two new tests cover `--model` forwarding with and without `--dangerously-bypass-approvals-and-sandbox`.
- **All 227 tests pass**; lint clean.
