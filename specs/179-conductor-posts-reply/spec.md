# Feature Specification: the conductor posts its own replies

**Branch**: `feature/179-conductor-posts-reply` | **Issue**: #179

## User Story

As the operator, I want the model to only write the answer and the conductor to post it, so a refused `gh` permission
in the model run can no longer block a reply (`Bash permission was denied … conductor-blocked`).

## Requirements

- FR-1: The conductor prompt no longer tells the model to run `gh issue comment` or `gh pr comment`. It tells the model
  to make the reply its final message, with no marker line, or to end with `NEEDS-HUMAN: <question>`.
- FR-2: The conductor reads the final message of the run and posts it with its own `gh` call to the reply target
  (issue or pull request), body on standard input, followed by the reply marker (or the rebase or CI-fix marker).
- FR-3: A `NEEDS-HUMAN:` final message is not posted; the existing label handling applies.
- FR-4: A run that prints no answer fails with `the model produced no answer`; a failed post is a failed run. The
  existing "did it post?" check still verifies the result.
- FR-5: The model run is given no permission to comment.
- FR-6: Applies to every conductor turn: issue, pull request, rebase, CI-fix and story child. `do-work` is unchanged.
- FR-7: `docs/conductor.md` and `CHANGELOG.md` (`Fixed`) describe the change.

## Assumptions

- [AUTO] `do-work` keeps its own posting prompt: the issue owner limited this issue to the conductor.
- [AUTO] The conductor appends the marker only when the model did not write it, so a model that ignores the
  instruction does not double it.
- [AUTO] `--dry-run` already works this way and is unchanged.
