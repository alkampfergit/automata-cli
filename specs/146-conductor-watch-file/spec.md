# Feature Specification: conductor watch list in its own file

**Branch**: `feature/146-conductor-watch-file` | **Issue**: #146 (part of epic #114)

## User Story

As the operator, I want the conductor watch list kept in a gitignored file, so that `conductor add`, `remove` and the tick's pruning do not make `git status` dirty.

## Requirements

- FR-1: The watch list is stored in `.automata/conductor-watch.json` as `{ "watch": [114, 120] }`.
- FR-2: `.automata/conductor-watch.json` is in `.gitignore` and in `AUTOMATA_OWN_PATHS`.
- FR-3: `add`, `remove`, `list`, the tick, `--check` and `--dry-run` read the list from the new file. `add`, `remove` and the prune write only the new file, never `config.json`.
- FR-4: A missing file, or a file that cannot be read or parsed, is an empty list.
- FR-5: When the new file does not exist and `conductor.watch` in `config.json` has entries, the entries are copied once into the new file. `config.json` is not rewritten. After that the old key is ignored.
- FR-6: `conductor.watch` is no longer documented as a config key. The other `conductor.*` keys stay.
- FR-7: `docs/conductor.md`, `docs/config.md` and `CHANGELOG.md` (`Unreleased`) document the change. README does not change.

## Assumptions

- [AUTO] File name: fixed `.automata/conductor-watch.json`; no `.automata/state/` folder (decided on the issue).
- [AUTO] Migration is not run when the file exists but is unreadable: the list is empty and the old key stays ignored, so a broken file is not silently replaced.
- [AUTO] A failed migration write is a warning on stderr; the migrated list is still used for that command.
- [AUTO] The file is written through a temporary file and a rename, as the lock files are.
