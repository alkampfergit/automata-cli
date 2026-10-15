# Planning Decisions: conductor CI-fix check

**Branch**: `feature/149-conductor-ci-fix`
**Date**: 2026-10-15
**Spec**: specs/149-conductor-ci-fix/spec.md · **Plan**: specs/149-conductor-ci-fix/plan.md · **Research**: specs/149-conductor-ci-fix/research.md

## Planning Decisions

- **The CI-fix request is a comment to the agent (option a of the issue).** Chosen to re-use loop safety, markers and the read-only permission model. Alternative: a `do-work` fix turn.
- **Wait while any check is pending.** Chosen because a pending check can still pass. Alternative: trigger on the first failure.
- **A conflicting pull request is left to the rebase check.** Chosen so one push gets one request. Alternative: run both.
- **Separate marker and counter.** Chosen so the CI-fix, rebase and reply limits stay independent. Alternative: one shared request marker.
