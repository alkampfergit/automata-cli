# PR Report: conductor-ready label

**Branch**: `feature/157-conductor-ready-label`
**Date**: 2026-10-19
**Spec**: specs/157-conductor-ready-label/spec.md

## Summary

The conductor now labels a pull request `conductor-ready` when a person can review and close it: open, not a draft, no merge conflict, no unresolved review thread and all checks green. automata sets and removes the label each tick; the model is not run and no comment is posted.

Closes #157

## What's New

- **Ready rule** (`src/conductor/readyLabel.ts`): a pure `isReady()` and `readyLabelChange()` decide add, remove or nothing.
- **Label sync** (`src/commands/conductor.ts`): each tick, and `--dry-run` as a printed line, syncs the label on each watched pull request and each pull request linked to a watched issue. A failed edit is a warning.
- **GitHub service** (`src/github/ghWorkService.ts`): `PrSurface` carries the pull request labels; new `removeLabel()`. `addLabel()` already creates a missing label.
- **Docs**: new "Ready label" section in `docs/conductor.md`; `CHANGELOG.md` entry under `Unreleased`.

## Testing

- **Unit** (`tests/unit/conductorReadyLabel.test.ts`): every readiness condition, skipped/neutral checks, the blocked label on the pull request and on the item, add/remove/no-op.
- **Full suite**: `npm test` (1904+ tests), `npm run lint` and `npm run typecheck` pass.

## Notes

- `sonar:local` still reports the two `no-await-in-loop` findings in `conductor.ts` that commit 972635d documents as pre-existing.
- `--check` does not list label changes.
- A pull request with no check at all is not ready.
