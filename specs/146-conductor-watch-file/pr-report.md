# PR Report: conductor watch list in its own file

**Branch**: `feature/146-conductor-watch-file`
**Date**: 2026-10-12
**Spec**: specs/146-conductor-watch-file/spec.md

## Summary

The conductor watch list is now kept in `.automata/conductor-watch.json`, a gitignored file. `conductor add`, `remove`
and the tick's pruning no longer change the tracked `config.json`, so `git status` stays clean.

## What's New

- **Watch store**: `readWatch()`/`writeWatch()` in `src/conductor/watchStore.ts`; a missing or unreadable file is an empty list.
- **Migration**: the old `conductor.watch` entries are copied once when the new file does not exist; `config.json` is not rewritten and the old key is ignored after that.
- **Gitignore**: the file is in `.gitignore` and in `AUTOMATA_OWN_PATHS`.
- **Docs**: `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`.

## Breaking Changes

- `conductor.watch` is no longer a config key. Existing lists migrate automatically on first read.

## Testing

- **Unit**: missing file, unreadable file, invalid JSON, migration, old key ignored afterwards, and `add`/`remove`/prune leaving `config.json` byte-identical (`tests/unit/watchStore.test.ts`).
- **Command**: existing conductor tests run against the mocked store; own-paths lists updated.
- `npm test && npm run lint` pass.

Closes #146
