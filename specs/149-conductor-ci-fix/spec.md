# Feature Specification: conductor CI-fix check

**Branch**: `feature/149-conductor-ci-fix` | **Issue**: #149

## User Story

As the operator, I want the conductor to ask the agent to fix a watched pull request that has a failed check, so that a red build does not wait for a person to notice it. The request text must be configurable.

## Requirements

- FR-1: A second "always check", `ciFix`, runs after the rebase check. It ignores the `conductor-blocked` label and the reply limit for ordinary replies.
- FR-2: It triggers on an open pull request (watched, or linked to a watched issue) with at least one failed check and no check still pending. A check is failed when its conclusion is `FAILURE`, `TIMED_OUT`, `ACTION_REQUIRED` or `CANCELLED`. While a check is pending the check does nothing.
- FR-3: It does not trigger when GitHub reports `mergeable: CONFLICTING`, because the rebase check comes first.
- FR-4: A triggered check is a conductor turn on that pull request. The model gets `conductor.prompts.ciFix` as its instructions and posts the request to the agent as a comment. The agent fixes the build.
- FR-5: The comment ends with the marker `<!-- automata:conductor-ci-fix head=<sha> -->`. It runs once for each head commit (skip reason `ci-fix-done`). It has its own counter, with the limit `conductor.maxRepliesPerItem` (skip reason `ci-fix-limit`). Only comments of the agent account count.
- FR-6: If the run ends with `NEEDS-HUMAN:`, the item gets the `conductor-blocked` label and the conductor posts one short note with the CI-fix marker, so the next tick does not run the model again for the same commit.
- FR-7: `conductor.ciFix.enabled` (default `true`) switches the check off. `conductor.prompts.ciFix` takes text or a `.md` file in `.automata/`. The default text is the one agreed in the issue.
- FR-8: The check waits while the `do-work` run lock is held, works in `--dry-run`, and shows in `--check`.
- FR-9: `config set conductor-prompt ciFix` and a wizard screen `Conductor — CI fix` set the prompt.
- FR-10: `docs/conductor.md`, `docs/config.md` and `CHANGELOG.md` (`Unreleased`) document the change. README does not change.

## Assumptions

- [AUTO] Option (a) of the issue: the model writes the request, the agent fixes the build.
- [AUTO] The failed-conclusion set is the one `git get-pr-info` already uses.
- [AUTO] A pull request with no checks, or only passing checks, does nothing.
- [AUTO] `conductor.ciFix.enabled` is hand-edited; there is no `config set` key (as for `maxRepliesPerItem`).
