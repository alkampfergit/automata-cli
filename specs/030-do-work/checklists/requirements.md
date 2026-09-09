# Requirements Checklist: `do-work` Autonomous Orchestrator

**Feature**: `specs/030-do-work/` | **Date**: 2026-09-09

## Completeness

- [X] Every functional requirement is traceable to a user story or an edge case
- [X] Every user story has acceptance scenarios in Given/When/Then form
- [X] Every clarification is recorded with its resolution and rationale (`spec-decisions.md`)
- [X] Every assumption is marked `[AUTO]` or attributed to the owner
- [X] Success criteria are observable without reading the implementation

## Consistency

- [X] Trust configuration reuses `allowedUsers` / `agentUser`; no parallel trust list is introduced
- [X] The last-run boundary rule matches feature 029 exactly (newest agent message, strict inequality)
- [X] Exit-code semantics are stated once and used consistently (0 / 1 / 2)
- [X] The Azure DevOps refusal matches `implement-next` and `execute-prompt check-issue`
- [X] The documentation convention is honoured: `docs/do-work.md` is a terse reference, the wiki carries the process, `README.md` only links
- [X] automata models no concept of a skill anywhere in the design — skills are named by prompt text only

## Safety of an unattended loop

- [X] No comment from an unauthorized account can trigger a model run (FR-012, SC-004)
- [X] The agent's own messages can never trigger a run (FR-011)
- [X] An unresolved review thread cannot retrigger forever (D11, FR-016)
- [X] The marker comment guarantees the boundary advances even when the model fails, and a failed marker aborts the item (FR-021, D15, D23)
- [X] The marker is deleted only after the agent's own answer is confirmed to exist, never on the strength of an exit code (FR-023, D26, D27)
- [X] A run that produced no answer updates the marker instead of deleting it, so the boundary holds and the same message is not answered twice (FR-024, D26)
- [X] An updated marker does not trigger an automatic retry — a human is asked instead, so a broken input cannot burn model calls indefinitely (FR-024, D29)
- [X] Reconciliation runs even when the model run threw, so no permanent unexplained "working" comment can be left behind (FR-026)
- [X] A delete or update failure is cosmetic and never changes an item's reported outcome (D31)
- [X] Assignment is additive and never discards human triage (FR-020, D22)
- [X] An unresolvable prompt refuses the tick rather than silently running different instructions (FR-007, D24)
- [X] A dirty working tree is never stashed, reset or discarded (FR-029, D14)
- [X] While one automata instance runs, no other instance does any work (FR-031, SC-007)
- [X] The lock is taken before any state-changing GitHub call, so a contending instance assigns nothing and posts nothing (FR-032)
- [X] A crashed instance cannot block the loop permanently (stale-lock reclaim, FR-031)
- [X] Model runs per tick are capped (FR-030)
- [X] The tool never merges, never closes an issue and never pushes to the base branch (D20, FR-046)
- [X] `--dry-run` proves what a real tick would do without spending a model call, assigning, or posting anything (FR-039, SC-008)

## Testability

- [X] The whole detection core is pure and testable with no `gh` binary (plan §12)
- [X] Every row of the turn-decision table has a named test (T016)
- [X] The answer predicate is pure and separately tested, including the marker-itself, timestamp-tie and thread-reply cases (T017a, D28)
- [X] The prompt contract is asserted, including the absence of unauthorized content and that the shipped defaults name no skill (T018)
- [X] `needsAssignment` is decided in the pure layer, so assignment behaviour is unit-testable and visible in `--dry-run` (T016)
- [X] The refactor of the shared conversation rules is proven behaviour-free by leaving its existing test file untouched (T009, D18)

## Documentation

- [X] The wiki covers concepts, lifecycle, detection rules, setup, prompts, operations, troubleshooting and roadmap (FR-045, T041–T049)
- [X] The prompt contract is documented with a worked example that names a skill (FR-047, T046)
- [X] The safety boundaries and the disposable-environment requirement are stated in one place (FR-046, T047)
- [X] The wiki is cross-checked against the implementation before completion (T050)
- [X] The wiki is publishable to the repository's GitHub wiki, which is enabled but currently empty (T050)

## Open items deferred by design

- [ ] An Azure DevOps backend for the detection core (T056)
- [ ] A landing step — merge on green and issue closure (T056, D20)
- [ ] Bot-reviewer turns, today served by `execute-prompt sonar` / `fix-comments` (T056, D7)
- [ ] Skills themselves: this feature authors none; prompts name whatever the operator installs (D5)
