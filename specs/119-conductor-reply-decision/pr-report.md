# PR Report: conductor reply decision

**Branch**: `feature/119-conductor-reply-decision`
**Date**: 2026-10-03
**Spec**: specs/119-conductor-reply-decision/spec.md

## Summary

Adds the pure rule that decides whether a watched item needs a conductor reply: `agentUser` spoke last and no allowed
user has answered, on the issue or its linked pull request. Closed and merged items are skipped by the same rule the
watch-list prune uses.

## What's New

- **Reply decision** (`src/conductor/replyDecision.ts`): `decideConductorReply`, built on `agentAnsweredAfter` with the roles swapped.
- **Shared closed rule**: `isWatchClosed`, now used by `pruneWatchList`.
- **Docs**: `docs/conductor.md`.

## Testing

- **Unit**: every outcome (reply, answered, no agent message, closed, other accounts, issue body, thread comments, issue/PR combinations).
- `npm test && npm run lint` pass.

Closes #119
