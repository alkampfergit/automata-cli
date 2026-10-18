# Research

## Decision: the conductor instructs the agent to fix and resolve
**Rationale**: The conductor run is read-only and comment-only; the agent has the write access. The reply is the "next instruction" the issue asks for.
**Alternatives considered**: Let the conductor resolve threads (widens permissions of an untrusted-input run).

## Decision: a Copilot turn is owed only when Copilot wrote after the conductor's newest reply
**Rationale**: Open threads stay open until the agent resolves them. Without this test every tick would post again. It is pure and uses the existing reply marker.
**Alternatives considered**: Count only the reply limit (burns the limit); a local state file (lost on a fresh checkout).

## Decision: the `do-work` run lock is the "agent is working" signal
**Rationale**: Agreed in the issue; `inspectRunLock` already reads it without changing it.
**Alternatives considered**: Ask GitHub for running workflows (slow, not the agent's own state).

## Decision: the loop is a thin wrapper around `runConductor`
**Rationale**: Each tick keeps its own lock, prune and release, so a crash between ticks leaves no lock. The wait is injectable for tests.
**Alternatives considered**: A long-lived lock for the whole loop (blocks `--check` and a second operator).

## Autonomous Decisions
All decisions above follow the issue discussion or were taken without user input; see the spec Assumptions.
