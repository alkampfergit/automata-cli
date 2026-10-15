# PR Report: conductor CI-fix check

**Branch**: `feature/149-conductor-ci-fix`
**Date**: 2026-10-15
**Spec**: specs/149-conductor-ci-fix/spec.md

## Summary

The conductor now asks the agent to fix a watched pull request that has a failed check, even when the `conductor-blocked` label is on the item. The instructions for the request are configurable.

## What's New

- **CI-fix check**: a second always check (`ciFixCheck` in `src/conductor/alwaysChecks.ts`) after the rebase check. It triggers on a failed check with none pending, and leaves a conflicting pull request to the rebase check.
- **Markers and counters**: the request ends with `<!-- automata:conductor-ci-fix head=<sha> -->`. It gives the once-per-head-commit rule (`ci-fix-done`) and a separate counter with the limit `conductor.maxRepliesPerItem` (`ci-fix-limit`).
- **`NEEDS-HUMAN:`**: the label is added again and a short note with the marker is posted, so the next tick does not repeat the run for the same commit. The shared request logic in `conductor.ts` and `thread.ts` now serves both rebase and CI-fix turns.
- **Config**: `conductor.prompts.ciFix` with the default agreed in the issue, `config set conductor-prompt ciFix`, a `Conductor — CI fix` wizard screen, and `conductor.ciFix.enabled` (default `true`).
- **Docs**: `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`.

## Testing

- **Unit**: the check, markers, counters and decision order (`conductorAlwaysChecks.test.ts`); `config set conductor-prompt ciFix`; wizard mock.
- **Command**: blocked item with a failed check, default prompt, pending/passing/no checks, disabled key, conflict first, once per head commit, own limit, `NEEDS-HUMAN` note, waiting on the `do-work` lock (`conductor.cmd.test.ts`).
- `npm test && npm run lint` pass.

## Notes

- Only watched items are handled. The conductor stays read-only; the agent fixes the build.

Closes #149
