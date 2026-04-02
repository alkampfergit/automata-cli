# PR Report: implement-next Multi-Issue Selection

**Branch**: `013-implement-next-selection`
**Date**: 2026-04-02
**Spec**: [specs/013-implement-next-selection/spec.md](spec.md)

## Summary

This feature enhances `automata implement-next` to handle the case where multiple GitHub issues match the configured filter. Instead of silently picking the first one, the command now presents a numbered list and lets the user choose. Two new flags (`--take-first` and `--limit`) cover non-interactive and higher-capacity scenarios. The issue number is now always visible before AI invocation and embedded in the prompt sent to Claude or Codex.

## What's New

- **`githubService.listIssues`**: Return type changed from `GitHubIssue | null` to `GitHubIssue[]`. Now accepts a `limit` parameter (default 10), which is forwarded to `gh issue list --limit`. This enables fetching multiple issues in one call.
- **Multi-issue selection UI**: When more than one issue matches, the command prints a numbered list (`[N] #<number> - <title>`) and waits for the user to enter a number. If the number of results equals the limit, a hint is shown that there may be more issues available.
- **`--take-first` flag**: Skips the interactive prompt and picks the first matching issue, printing the selection before proceeding. Safe for non-interactive (CI/pipe) contexts.
- **`--limit <n>` flag**: Controls how many issues are fetched from GitHub (overrides the default of 10). Validates that the value is a positive integer.
- **Issue number in AI prompt**: Every prompt sent to Claude or Codex now begins with `Resolving issue #<number>:`, ensuring the AI always knows which issue it is working on.
- **Single-issue confirmation**: When exactly one issue matches, its ID and title are always printed before any AI tool is launched.

## Testing

- **Unit (mock-based)**: All new paths are covered in `tests/unit/getReady.cmd.test.ts` using `spawnSync` mocks for `gh`/`claude`/`codex` and a `node:readline` mock for interactive input. Scenarios covered: single-issue print, multi-issue list and selection, `--take-first`, `--limit` forwarding, `--query-only` multi-issue, invalid selection input, invalid `--limit` value, and issue number in both Claude and Codex prompts.
- **CLI smoke**: `--help` output verified to include `--take-first` and `--limit`.
- **Regression**: All 220 existing tests continue to pass. `githubService` unit tests updated to match new array return type.
