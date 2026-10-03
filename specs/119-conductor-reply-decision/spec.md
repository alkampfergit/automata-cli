# Feature Specification: conductor reply decision

**Branch**: `feature/119-conductor-reply-decision` | **Issue**: #119 (part of epic #114)

## User Story

As the operator, I want one pure rule that says whether a watched item needs a conductor reply, so the conductor
answers exactly when `agentUser` spoke last and no allowed user has answered yet.

## Requirements

- FR-1: `decideConductorReply` takes the conversations of a watched item (the issue and its linked PR) and returns, per
  conversation, `reply` or `skip` with a reason (`closed`, `no-agent-message`, `answered`).
- FR-2: A reply is owed when the newest message from `agentUser` has no later message from any allowed user. It reuses
  `agentAnsweredAfter` with the roles swapped; other accounts are ignored.
- FR-3: A closed issue or closed/merged PR is skipped. The rule (`isWatchClosed`) is the one the tick-start prune uses.
- FR-4: Pure: no I/O. Unit tests cover every outcome.

## Assumptions

- [AUTO] Reuse: chose `agentAnsweredAfter` per allowed user over `decideWork`, because `decideWork` returns do-work turn items and needs a single agent identity; the swapped question is one level simpler.
- [AUTO] Agent-authored issue body: chose to count it as an unanswered agent message, because an issue the agent opened is waiting for a human.
- [AUTO] Same-second answer: chose to keep `agentAnsweredAfter`'s strict comparison, so it reads as unanswered; the cost is a possible extra reply, never a missed one.
- [AUTO] Review-thread comments: chose to count them in a PR's conversation, because `do-work` does the same.
- [AUTO] Scope: chose no CLI wiring; the module is consumed by later conductor issues. No CHANGELOG bullet (not user-visible).
