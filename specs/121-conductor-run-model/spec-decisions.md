# Spec Decisions: conductor runs the model and posts the reply

**Branch**: `feature/121-conductor-run-model`
**Date**: 2026-10-04
**Spec**: specs/121-conductor-run-model/spec.md
**Plan**: specs/121-conductor-run-model/plan.md
**Research**: specs/121-conductor-run-model/research.md

## Planning Decisions

- **Read-only rule**: in the argv builders. **Rationale**: one place builds the argv. **Alternatives considered**: flags at the call site.
- **Claude permissions**: `dontAsk` with an allow-list. **Rationale**: an unlisted tool is refused. **Alternatives considered**: `plan` mode, which cannot run `gh`.
- **Posting instruction**: appended by automata after the thread. **Rationale**: a custom frame cannot lose it. **Alternatives considered**: only in the default prompts.
- **Detection**: compare the account's comments before and after. **Rationale**: no transcript needed, both executors. **Alternatives considered**: transcript recovery (#115).
