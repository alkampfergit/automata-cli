# PR Report: conductor --check and --dry-run

**Branch**: `feature/123-conductor-check-dry-run`
**Date**: 2026-10-05
**Spec**: specs/123-conductor-check-dry-run/spec.md

## Summary

Adds `automata conductor --check`, a read-only report of what a tick would do, and `automata conductor --dry-run`, which
writes the replies and prints them without posting. This pull request builds on #134 and targets its branch; it moves
to `develop` after #134 merges.

## What's New

- **`--check`** (`src/conductor/checkReport.ts`): configuration, run lock, watch list with pending prunes, reply decisions; exit 0/1.
- **`--dry-run`**: the model runs without comment permission; its final message is printed (`src/conductor/dryRunReply.ts`, `dryRunInstruction`).
- **Lock inspection**: `inspectConductorLock`.
- **Docs**: `docs/conductor.md`, `CHANGELOG.md`.

## Testing

- **Unit**: the report, the lock section, reply extraction, the dry-run prompt, and the command paths (no lock, no write, no model for `--check`; no post for `--dry-run`).
- `npm test && npm run lint` pass.

## Notes

- `--no-fetch` is not added: the conductor has no git fetch.

Closes #123
