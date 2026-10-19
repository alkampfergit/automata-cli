# Feature Specification: conductor-ready label

**Branch**: `feature/157-conductor-ready-label` | **Issue**: #157

## User Story

As the operator, I want the conductor to label a pull request `conductor-ready` when it can be reviewed and closed by a person, so that I find such pull requests at once.

## Requirements

- FR-1: A pull request is ready when it is open, not a draft, not `CONFLICTING`, has no unresolved review thread, and has at least one check and all checks are finished and green. No approving review is needed.
- FR-2: Each tick, for each watched pull request and each open pull request linked to a watched issue, automata adds the label `conductor-ready` when the pull request is ready and lacks it, and removes it when the pull request is not ready and has it. A new push, a failed or pending check, a new unresolved thread or a conflict therefore remove it.
- FR-3: automata creates the label when the repository lacks it. The model is not involved and has no permission to edit labels.
- FR-4: A pull request that has the `conductor-blocked` label is not ready.
- FR-5: The conductor posts no comment for the label.
- FR-6: A failure to add or remove the label is a warning on stderr. It does not change the exit code.
- FR-7: `--dry-run` prints what it would do and changes nothing. `--check` does not list label changes.
- FR-8: `docs/conductor.md` and `CHANGELOG.md` (`Added`) document the change.

## Assumptions

- [AUTO] A skipped or neutral check conclusion counts as green; `FAILURE`, `TIMED_OUT`, `ACTION_REQUIRED` and `CANCELLED` do not.
- [AUTO] A pull request with no check at all is not ready: a missing check is not proof of a green build.
- [AUTO] A `UNKNOWN` merge state does not block readiness; only `CONFLICTING` does.
- [AUTO] The always-check mechanism is not used: it asks the model to act. The label sync is a separate pure rule plus one effect in `conductItem`.
