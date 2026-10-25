# Feature Specification: do-work passes the prompt on stdin

**Branch**: `feature/164-prompt-via-stdin` | **Issue**: #40

## User Story

As the operator, I want `do-work` to hand the prompt to Claude and Codex on stdin, so a long conversation does not
fail with `E2BIG` (Linux caps one argument at 128 KiB).

## Requirements

- FR-1: `buildClaudeArgs` and `buildCodexArgs` take `promptOn: "argv" | "stdin"`, default `"argv"`. On `"stdin"` Claude
  gets a bare `-p` and Codex gets `-`.
- FR-2: `runClaude` and `runCodex` spawn with a piped stdin, write the prompt and close the stream. `EPIPE` and
  `ERR_STREAM_DESTROYED` on stdin are swallowed; only the `close` event settles the run.
- FR-3: `do-work --dry-run` writes the prompt to `<tmpdir>/automata-prompts-<uid>/automata-prompt-<owner>-<repo>-<hash>-<issue|pr>-<n>-<turn>.txt` (directory `0700`, file `0600`, replaced without following links)
  (overwritten on each run) and prints the command with `< <file>`. `--dry-run --json` keeps `prompt` and adds
  `promptFile`.
- FR-4: The 96 KiB guard (`describeOversizedPrompt` and its refusal) is removed.
- FR-5: Tests run stub executables with a 256 KiB prompt, and one that exits without reading.
- FR-6: `docs/do-work.md` and `CHANGELOG.md` describe the change.

## Assumptions

- [AUTO] Out of scope: `invokeClaudeCode`, `invokeClaudeCodeVerbose`, `invokeCodexCode` (small prompts, argv),
  `src/run/answerRecovery.ts` (its own deliberate 96 KiB cap) and `src/run/secondOpinion.ts`.
- [AUTO] `runClaude` and `runCodex` are shared with the conductor, so it also sends its prompt on stdin.
- [AUTO] Spec number 164: 163 is the highest in use.
