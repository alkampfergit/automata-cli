# Plan: conductor --check and --dry-run

- `src/conductor/checkReport.ts` (pure): `buildConductorCheck`, `lockSection`, `watchSections`.
- `src/conductor/dryRunReply.ts` (pure): `extractDryRunReply` reads the final message from the captured stdout.
- `src/conductor/thread.ts`: `dryRunInstruction`; `composeConductorPrompt` takes `dryRun`.
- `src/run/runLock.ts`: `inspectRunLock` takes a lock file name; `inspectConductorLock`.
- `src/commands/conductor.ts`: `--check` and `--dry-run` options; `runConductor(options)`.
- Docs: `docs/conductor.md`, `CHANGELOG.md`.
- Tests: `conductorCheckReport.test.ts`, `conductor.cmd.test.ts`, `conductorThread.test.ts`.
