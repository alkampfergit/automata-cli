# Planning Decisions: conductor automatic mode

**Branch**: `feature/142-conductor-automatic`
**Date**: 2026-10-12
**Spec**: specs/142-conductor-automatic/spec.md · **Plan**: specs/142-conductor-automatic/plan.md · **Research**: specs/142-conductor-automatic/research.md

## Planning Decisions

- **The conductor instructs the agent to fix and resolve.** Chosen because the run is read-only and comment-only. Alternative: let the conductor resolve threads.
- **A Copilot turn is owed only when Copilot wrote after the newest conductor reply.** Chosen so open threads do not draw a reply on every tick. Alternatives: rely on the reply limit; a local state file.
- **The `do-work` run lock means "agent working".** Agreed in the issue. Alternative: ask GitHub for running workflows.
- **The loop wraps `runConductor`.** Chosen so each tick keeps its own lock and prune. Alternative: one lock for the whole loop.
