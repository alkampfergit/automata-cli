# Research

## Decision: the CI-fix request is a comment to the agent (option a of the issue)
**Rationale**: Re-uses the loop-safety rules, markers and read-only permission model of the rebase check.
**Alternatives considered**: A `do-work` fix turn with no conductor message (new turn kind, separate loop safety).

## Decision: wait while any check is pending
**Rationale**: A pending check can still pass or fail; asking early makes a request for a build that may be green.
**Alternatives considered**: Trigger on the first failed check (duplicate requests while the agent works).

## Decision: a conflicting pull request is left to the rebase check
**Rationale**: A conflict makes the checks stale; the rebase comes first and a push re-arms both checks.
**Alternatives considered**: Run both (two requests for one push).

## Decision: separate marker and counter
**Rationale**: As for the rebase marker: the state lives in the conversation and the three counters stay apart.
**Alternatives considered**: One shared "request" marker (a rebase would use up the CI-fix limit).

## Autonomous Decisions
All decisions follow the issue discussion; see the spec Assumptions.
