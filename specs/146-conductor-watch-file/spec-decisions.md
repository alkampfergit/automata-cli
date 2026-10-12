# Planning Decisions: conductor watch list in its own file

**Branch**: `feature/146-conductor-watch-file`
**Date**: 2026-10-12
**Spec**: specs/146-conductor-watch-file/spec.md · **Plan**: specs/146-conductor-watch-file/plan.md · **Research**: specs/146-conductor-watch-file/research.md

## Planning Decisions

- **A separate gitignored file in `.automata/`.** The list is machine state and `config.json` is tracked. Alternatives: a `.automata/state/` folder; ignoring `config.json`.
- **Copy the old entries once, do not rewrite `config.json`.** Keeps the tree clean and the migration idempotent. Alternatives: delete the old key; read both keys always.
- **An unreadable file is an empty list, with no migration.** A migration would overwrite the broken file. Alternative: fail the command.
