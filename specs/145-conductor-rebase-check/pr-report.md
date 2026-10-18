# PR Report: conductor rebase check

**Branch**: `feature/145-conductor-rebase-check`
**Date**: 2026-10-12
**Spec**: specs/145-conductor-rebase-check/spec.md

## Summary

The conductor now asks the agent to rebase a watched pull request that has a merge conflict, even when the `conductor-blocked` label is on the item. The request text is configurable.

## What's New

- **Rebase check**: a pure "always check" (`src/conductor/alwaysChecks.ts`) runs before the loop-safety stop. It triggers on `mergeable: CONFLICTING` of an open watched pull request; `UNKNOWN` is retried on the next tick. The list of always checks (`ALWAYS_CHECKS`) takes more checks later.
- **Counters in the conversation**: a rebase request ends with `<!-- automata:conductor-rebase head=<sha> -->`. It gives the once-per-head-commit rule and a separate counter with the limit `conductor.maxRepliesPerItem`.
- **`NEEDS-HUMAN:` on a rebase run**: the label is added again and a short note with the marker is posted, so the next tick does not repeat the run for the same commit.
- **`conductor.prompts.rebase`**: config key with a built-in default (the text of the issue), `config set conductor-prompt rebase`, and a `Conductor — Rebase` wizard screen.
- **GitHub read**: `getPrSurface` also reads `mergeable` and `headRefOid`.
- **Docs**: `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`.

## Testing

- **Unit**: the rebase rule, markers and counters, the decision with a blocked item (`conductorAlwaysChecks.test.ts`).
- **Command**: blocked item with a conflict is rebased, `UNKNOWN` and `MERGEABLE` are not, once per head commit, separate limit, `NEEDS-HUMAN` note, waiting while the `do-work` lock is held (`conductor.cmd.test.ts`); `config set conductor-prompt rebase`.
- `npm test && npm run lint` pass.

## Notes

- Only watched items are rebased. The conductor stays read-only; the agent does the rebase.

Closes #145
