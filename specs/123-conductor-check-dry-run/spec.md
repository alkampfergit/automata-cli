# Feature Specification: conductor --check and --dry-run

**Branch**: `feature/123-conductor-check-dry-run` | **Issue**: #123 (part of epic #114)

## User Story

As the operator, I want to see what a conductor tick would do, and what it would write, before it posts anything.

## Requirements

- FR-1: `automata conductor --check` prints a read-only report: configuration and identity, the run lock, the watch list with the entries a tick would drop, and the reply decision per conversation. It exits 0, or 1 when the report has a problem.
- FR-2: `--check` takes no lock, prunes nothing, posts nothing and starts no model.
- FR-3: `automata conductor --dry-run` runs the model for each owed reply and prints the reply with its target. It posts nothing and does not change the watch list.
- FR-4: `--check` with `--dry-run` is a usage error (exit 1).
- FR-5: `docs/conductor.md` and `CHANGELOG.md` document both options.

## Assumptions

- [AUTO] Base: chose to build on `feature/121-conductor-run-model` (PR #134) because the tick that runs the model is not in `develop` yet. The pull request targets that branch and moves to `develop` after #134 merges.
- [AUTO] AI call: chose to call the model in `--dry-run`, because without it there are no replies to show.
- [AUTO] Lock: chose not to take the lock in `--dry-run` and to warn when a conductor holds it, because the run is read-only.
- [AUTO] `--no-fetch`: chose not to add it. The conductor reads GitHub through `gh` only and has no git fetch to skip.
- [AUTO] Capture: chose to run the model without comment permission and to read its final message, because the live run discards its output.
- [AUTO] Problems: chose that a live lock, a pending prune and an owed reply are not problems; an unusable configuration, a `suspect` or `unreadable` lock and an unreadable watched id are.
