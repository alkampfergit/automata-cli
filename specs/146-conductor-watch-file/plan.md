# Plan: conductor watch list in its own file

- `src/conductor/watchStore.ts`: `readWatch()` (with the one-time migration) and `writeWatch()`.
- `src/run/runLock.ts`: `WATCH_RELATIVE_PATH`, added to `AUTOMATA_OWN_PATHS`.
- `src/commands/conductor.ts`: use `readWatch`/`writeWatch`; `pruneWatchList()` takes no argument.
- `src/config/configStore.ts`: `conductor.watch` is marked deprecated (read only for the migration).
- `.gitignore`, `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`.
- Tests: new `tests/unit/watchStore.test.ts`; `conductor.cmd.test.ts` mocks the store; the own-paths lists in `repoHygiene` and `workspaceService` tests.
