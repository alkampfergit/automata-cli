# Research: conductor-ready label

## Autonomous Decisions

### Decision: where the rule lives
Pure function `readyDecision()` in `src/conductor/readyLabel.ts`; the effect (`addLabel`/`removeLabel`) in `conductItem`.
**Rationale**: the rule is testable without `gh`; `addLabel` already creates a missing label. **Alternatives considered**: an `ALWAYS_CHECKS` entry (it yields model turns, not label changes); letting the model decide (needs a label permission, which it must not have).

### Decision: label state source
Add `labels` to the `gh pr view --json` fields of `getPrSurface` and read them from `PrSurface`.
**Rationale**: a pull request linked to a watched issue has no `WatchTarget`. **Alternatives considered**: an extra REST call per pull request.

### Decision: no comment
Only the label changes. **Rationale**: decided on the issue ("only if needed"); none is needed.

### Decision: failure handling
Warn and go on. **Rationale**: the label is a convenience signal; a failed edit must not fail the tick or block replies.
