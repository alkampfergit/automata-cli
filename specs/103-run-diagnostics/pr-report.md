# PR Report: Run diagnostics when the agent posts no answer

**Branch**: `feature/103-run-diagnostics`
**Date**: 2026-09-30
**Spec**: specs/103-run-diagnostics/spec.md

## Summary

When a `do-work` agent run finishes without posting an answer, the fallback comment used to say only that. It now says
why the run was silent: exit code or signal, duration, whether a branch, pull request or commit appeared, and a redacted
excerpt of the agent's output. The full transcript stays on disk and only its file name is posted.

## What's New

- **Transcript** (`src/run/runTranscript.ts`): saves each run's output under `.automata/runs/`, redacts and caps the excerpt.
- **Runners**: `runClaude` and `runCodex` accept an optional sink; stderr is piped and still forwarded to the terminal.
- **`do-work`**: appends diagnostics to the no-answer comment, gated by the new `doWork.postRunLog` key (default `true`).
- **Docs**: `docs/do-work.md`, `docs/config.md`, `CHANGELOG.md`.

## Testing

- **Unit**: redaction, readable-line extraction, excerpt cap, transcript file, diagnostics rendering.
- **Command**: the fallback comment with diagnostics, without leaking a token or a path, and with `postRunLog: false`.

## Notes

- `postRunLog` is edited in `config.json`; there is no `config set` command or wizard screen for it yet.
- Transcripts are not pruned.
