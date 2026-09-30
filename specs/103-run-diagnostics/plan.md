# Plan: Run diagnostics

- `src/run/runTranscript.ts`: `RunTranscript` (file + in-memory readable tail), `redactSecrets`, `readableLine`,
  `capExcerpt`, `renderRunDiagnostics`.
- `runClaude` / `runCodex` accept an optional `sink` and pipe stderr (still forwarded to the terminal); the sink sees
  every chunk and the exit status.
- `doWork.ts`: create the transcript before the run when `postRunLog`, snapshot branch/HEAD before and after, and pass a
  lazy diagnostics renderer to `reportNoAnswer`, so only a silent run pays for the git/gh calls.
- Docs: `docs/do-work.md`, `docs/config.md`, `CHANGELOG.md`.
- Tests: `tests/unit/runTranscript.test.ts`, two cases in `tests/unit/doWork.cmd.test.ts`.
