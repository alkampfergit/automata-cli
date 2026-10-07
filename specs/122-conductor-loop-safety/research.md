# Research

## Decision: count replies with a body marker
**Rationale**: The conversation is the only state that all checkouts share; the conductor posts as a human account, so the author alone cannot tell its replies from the person's own comments.
**Alternatives considered**: A local state file (lost on a fresh checkout); counting every comment of the account (counts the person's own comments).

## Decision: the model signals "needs a human" in its output
**Rationale**: The run is read-only; automata applies the label itself and keeps label permissions away from the model.
**Alternatives considered**: Allow `gh issue edit --add-label` in the run (widens permissions, hard to bound to one label).

## Decision: block at the watched item
**Rationale**: The label is on the thing the operator added to the list, so it is easy to find and clear.
**Alternatives considered**: Label the linked pull request (hides the block from the issue).

## Autonomous Decisions
All decisions above were taken without user input; see the spec Assumptions.
