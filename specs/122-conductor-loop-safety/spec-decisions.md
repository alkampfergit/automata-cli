# Planning Decisions: conductor loop safety

**Branch**: `feature/122-conductor-loop-safety`
**Date**: 2026-10-06
**Spec**: specs/122-conductor-loop-safety/spec.md · **Plan**: specs/122-conductor-loop-safety/plan.md · **Research**: specs/122-conductor-loop-safety/research.md

## Planning Decisions

- **Count replies with a body marker.** Chosen because the conversation is the one record all checkouts share and the conductor posts as a human account. Alternatives: a local state file; counting every comment of the account.
- **The model signals "needs a human" in its output.** Chosen because the run is read-only and must not get label permissions. Alternative: allow `gh issue edit --add-label` in the run.
- **Block at the watched item.** Chosen so the operator finds and clears the label where they added the item. Alternative: label the linked pull request.
