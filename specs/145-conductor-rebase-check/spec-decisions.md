# Planning Decisions: conductor rebase check

**Branch**: `feature/145-conductor-rebase-check`
**Date**: 2026-10-12
**Spec**: specs/145-conductor-rebase-check/spec.md · **Plan**: specs/145-conductor-rebase-check/plan.md · **Research**: specs/145-conductor-rebase-check/research.md

## Planning Decisions

- **The rebase request is a comment to the agent.** Chosen because the run is read-only and comment-only. Alternative: let the conductor rebase itself.
- **Counters and the once-per-SHA rule live in a hidden marker in the conversation.** Chosen as for the reply counter; no new local file. Alternative: a local state file.
- **On `NEEDS-HUMAN` the conductor posts a note with the marker.** Chosen because the check ignores the label and nothing else records the SHA. Alternative: stay silent (loops every tick).
- **Trigger on `mergeable == CONFLICTING` only.** Chosen because `UNKNOWN` is lazy and is retried. Alternative: `mergeStateStatus == DIRTY`.
- **Always checks are a list of pure functions.** Agreed in the issue. Alternative: a `conductor.alwaysChecks` config list.
