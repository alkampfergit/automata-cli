# Plan: conductor skeleton

- `src/run/runLock.ts`: `acquireRunLock(command, staleMinutes, lockFile = LOCK_FILE)`; export `CONDUCTOR_LOCK_RELATIVE_PATH`
  and add it to `AUTOMATA_OWN_PATHS`.
- `src/github/identity.ts`: `conductorIdentityProblemFor(identity, agentUser, allowedUsers)` (pure).
- `src/commands/conductor.ts`: `conductorCommand`; reads config, checks identity, takes the lock, releases it.
- `src/index.ts`: register the command.
- Docs: `docs/conductor.md`, README row, CHANGELOG.
- Tests: `tests/unit/runLock.test.ts` (separate lock files), `tests/unit/identity` cases, `tests/unit/conductor.cmd.test.ts`;
  update the exact-list assertions for `AUTOMATA_OWN_PATHS`.
