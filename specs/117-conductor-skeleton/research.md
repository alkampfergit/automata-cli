# Research

## Autonomous Decisions

- **Decision**: Parameterise `acquireRunLock` with a lock file name. **Rationale**: reuses the audited atomic
  link/claim/reclaim code. **Alternatives considered**: copying the module (duplicates a race-sensitive primitive).
- **Decision**: Add the conductor lock to `AUTOMATA_OWN_PATHS`. **Rationale**: otherwise a conductor lock makes every
  `do-work` tick skip as `dirty-tree`. **Alternatives considered**: a separate constant (misses four call sites).
- **Decision**: Fail on an unverifiable `gh` identity. **Rationale**: the role requires proof of being an allowed human.
  **Alternatives considered**: warn and continue, as `do-work` does.
