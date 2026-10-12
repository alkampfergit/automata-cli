# Research

## Decision: a separate gitignored file in `.automata/`
**Rationale**: The list is machine state. `config.json` is tracked, so each write dirtied `git status`.
**Alternatives considered**: A `.automata/state/` folder (rejected on the issue); keep the key and gitignore `config.json` (hides real configuration).

## Decision: copy the old entries once and do not rewrite `config.json`
**Rationale**: Keeps the tree clean and the migration idempotent: the new file's existence ends it.
**Alternatives considered**: Delete the old key (dirties the tree); read both keys on every call (the old key would bring back removed items).

## Decision: an unreadable file is an empty list without migration
**Rationale**: Matches the agreed rule; a migration over a broken file would overwrite it.
**Alternatives considered**: Fail the command (blocks the conductor on a hand-edit).

## Autonomous Decisions
All decisions follow the issue discussion; see the spec Assumptions.
