# Implementation Plan: conductor-ready label

**Branch**: `feature/157-conductor-ready-label` | **Spec**: [spec.md](spec.md)

## Summary
A pure rule decides `add`, `remove` or nothing from the pull request state; `conductItem` applies it each tick.

## Technical Context
TypeScript 5.x strict, commander.js, `gh` via `spawnSync`, vitest.

## Structure
- `src/conductor/readyLabel.ts` (new): `READY_LABEL`, `isReady()`, `readyLabelChange()`.
- `src/github/ghWorkService.ts`: `labels` on `PrSurface`; new `removeLabel()`.
- `src/commands/conductor.ts`: `syncReadyLabels()` called from `conductItem`; the dry run and `--check` report.
- `docs/conductor.md`, `CHANGELOG.md`.
- `tests/unit/conductorReadyLabel.test.ts`.
