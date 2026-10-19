# Spec Decisions: conductor-ready label

**Branch**: `feature/157-conductor-ready-label`
**Date**: 2026-10-19
**Spec**: specs/157-conductor-ready-label/spec.md
**Plan**: specs/157-conductor-ready-label/plan.md
**Research**: specs/157-conductor-ready-label/research.md

## Planning Decisions

- **Where the rule lives**: a pure function in `src/conductor/readyLabel.ts`, the effect in `conductItem`. **Rationale**: testable without `gh`; `addLabel` already creates a missing label. **Alternatives considered**: an `ALWAYS_CHECKS` entry (it yields model turns); a model decision (needs a label permission).
- **Label state source**: add `labels` to the `gh pr view` fields. **Rationale**: a linked pull request has no `WatchTarget`. **Alternatives considered**: an extra REST call per pull request.
- **No comment**: only the label changes. **Rationale**: decided on the issue. **Alternatives considered**: a note on removal.
- **Failure handling**: warn and go on. **Rationale**: the label is a signal and must not fail the tick. **Alternatives considered**: exit 1, as for `conductor-blocked`.
