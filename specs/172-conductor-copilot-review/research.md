# Research

## Autonomous Decisions

- Decision: spec number 172. Rationale: equals the issue; 165 is used by a remote branch. Alternatives considered: 166.
- Decision: no new dependency; the existing `gh` wrappers and `addCopilotReviewer` are enough.
- Decision: `copilot-review-type` is stored only. Rationale: `gh pr edit --add-reviewer @copilot` has no mode option (issue #172, agreed).
