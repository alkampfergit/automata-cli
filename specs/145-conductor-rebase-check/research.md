# Research

## Decision: the rebase request is a comment to the agent
**Rationale**: The conductor run is read-only and comment-only; the agent has write access. This keeps the permission model of the existing turns.
**Alternatives considered**: Let the conductor rebase itself (widens the permissions of a run that reads untrusted text).

## Decision: counters and the once-per-SHA rule live in a hidden marker in the conversation
**Rationale**: As for the reply counter, the state survives a fresh checkout and needs no new file in `AUTOMATA_OWN_PATHS`. The marker has no substring of the reply marker, so the two counters stay separate.
**Alternatives considered**: A local state file (lost on a fresh checkout, extra ignore rules).

## Decision: on `NEEDS-HUMAN` the conductor posts a note with the marker
**Rationale**: Without a comment nothing records the SHA, and the check ignores the label, so it would run every tick.
**Alternatives considered**: Stay silent and rely on the label (loops); write a local state file (see above).

## Decision: trigger on `mergeable == CONFLICTING` only
**Rationale**: GitHub computes the value lazily; `UNKNOWN` is retried on the next tick as agreed.
**Alternatives considered**: `mergeStateStatus == DIRTY` (same meaning, a second field to read).

## Decision: always checks are a list of pure functions
**Rationale**: Agreed in the issue: only one check now, shape for more.
**Alternatives considered**: A `conductor.alwaysChecks` config list (wider than asked).

## Autonomous Decisions
All decisions follow the issue discussion; see the spec Assumptions.
