# Plan: conductor watch list

- `src/config/configStore.ts`: `AutomataConductorConfig { watch?: number[] }`, `AutomataConfig.conductor`.
- `src/conductor/watchList.ts` (pure): `parseWatchId`, `normalizeWatch`, `withWatched`, `withoutWatched`.
- `src/github/ghWorkService.ts`: `getWatchTarget(n)` (one REST call: kind, state, title) and `applyDiscovery(target, technique, value)`.
- `src/commands/conductor.ts`: `add`/`remove`/`list` subcommands; `pruneWatchList` called in the tick after the lock.
- Docs: `docs/conductor.md`, `docs/config.md` key, CHANGELOG.
- Tests: `tests/unit/watchList.test.ts`, extend `tests/unit/conductor.cmd.test.ts`, `ghWorkService.test.ts` cases.
