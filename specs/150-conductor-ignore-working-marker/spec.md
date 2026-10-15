# Feature Specification: conductor ignores the working marker

**Branch**: `feature/150-conductor-ignore-working-marker` | **Issue**: #150

## User Story

As the operator, I want the conductor to leave an item alone while a `do-work` run is in flight, so that it does not ask for a reply to the `automata do-work: working…` marker.

## Requirements

- FR-1: One constant, `WORKING_MARKER`, and one helper, `isWorkingMarker()`, name the marker. `do-work` and the conductor use them.
- FR-2: `decideByAgentMessage()` does not take a marker as the agent's message that waits for an answer. The newest real agent message stays the reference.
- FR-3: When the newest marker is newer than the newest real agent message (or there is none) and no allowed user wrote after it, the item is skipped with the new reason `agent-working`.
- FR-4: The rule holds for review-thread comments. The Copilot turn does not fire while the item is `agent-working`.
- FR-5: `docs/conductor.md` and `CHANGELOG.md` (`Fixed`) document the change.

## Assumptions

- [AUTO] A stale marker of a crashed run keeps the item quiet until a human writes or the next `do-work` tick answers it. No timeout (decided on the issue).
- [AUTO] The explanatory markers (interrupted, failed run) are real messages: they ask the human to reply.
