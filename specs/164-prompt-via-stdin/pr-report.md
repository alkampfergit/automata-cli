# do-work passes the prompt on stdin

**Branch**: `feature/164-prompt-via-stdin` | **Date**: 2026-10-25 | **Spec**: [spec.md](specs/164-prompt-via-stdin/spec.md)

Closes #40

## Summary

`do-work` now gives the prompt to Claude and Codex on stdin, so a long conversation no longer fails with `E2BIG`. The 96 KiB refusal is removed. `--dry-run` still prints a pasteable command that equals the real one.

## What's New

- `buildClaudeArgs` / `buildCodexArgs` take `promptOn` (`argv` default, `stdin` gives a bare `-p` / `-`).
- `runClaude` / `runCodex` pipe stdin through the new `feedStdin()`; `EPIPE` is left to the `close` handler.
- `--dry-run` writes a fixed-name prompt file under the temporary directory and prints `… < file`; `--json` adds `promptFile`.
- `describeOversizedPrompt` and its refusal are removed.
- `docs/do-work.md` and `CHANGELOG.md` updated.

## Testing

- Unit: builders, mocked runners, dry-run output and file.
- Integration: stub `claude` / `codex` on `PATH` receive a 256 KiB prompt byte for byte; a stub that exits at once gives an exit-code failure, not `EPIPE`.

## Notes

- `sonar:local` reports one `no-await-in-loop` in `doWork.ts` (the per-item loop, not changed here). It appears on any edit of the file and is kept.
- `answerRecovery.ts`, `secondOpinion.ts` and the `invoke*` functions are unchanged. The conductor also uses stdin through `runClaude`.
