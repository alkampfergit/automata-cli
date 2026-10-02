# PR Report: conductor watch list

**Branch**: `feature/118-conductor-watch-list`
**Date**: 2026-10-02
**Spec**: specs/118-conductor-watch-list/spec.md

## Summary

Gives `automata conductor` a watch list of issues and pull requests, stored in `.automata/config.json`. The operator
manages it with `add`, `remove` and `list`; `add` also makes `do-work` pick the item up, and each tick drops items that
have closed or merged.

## What's New

- **Watch list** (`src/conductor/watchList.ts`, `conductor.watch` in `configStore.ts`): pure helpers and the config key.
- **`conductor add|remove|list`** (`src/commands/conductor.ts`): `add` applies the discovery label/assignee and follows linked PRs; `remove` leaves GitHub alone.
- **Tick pruning**: closed issues and closed/merged PRs are dropped at the start of each tick, each removal logged.
- **GitHub helpers** (`src/github/ghWorkService.ts`): `getWatchTarget`, `applyDiscovery`.
- **Docs**: `docs/conductor.md`, `docs/config.md`, CHANGELOG bullet.

## Testing

- **Unit**: id parsing and list normalisation; `gh` argument shapes for resolving and applying discovery.
- **Command**: add (label, linked PR, duplicate, closed, bad id, discovery failure), remove, list, tick pruning.
- `npm test && npm run lint` pass.

## Notes

- `title-contains` discovery cannot be applied to an existing item, so `add` fails with it.
