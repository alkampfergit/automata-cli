# Feature Specification: conductor loop safety

**Branch**: `feature/122-conductor-loop-safety` | **Issue**: #122 (part of epic #114)

## User Story

As the operator, I want the conductor to stop on its own when it and the agent talk in circles, so that I can run it unattended from cron.

## Requirements

- FR-1: `conductor.maxRepliesPerItem` (positive integer, default 5) is the most replies the conductor posts on one watched item (the issue and its linked pull requests together). At the limit the item gets no more replies and the tick logs why. The setting is validated before the lock is taken.
- FR-2: The conductor counts its replies from the conversation, not from a local file: the posting instruction makes the model end each reply with the marker `<!-- automata:conductor -->`, and the count is the number of comments that carry it.
- FR-3: The model can answer "needs a human". It posts no comment and ends its final message with `NEEDS-HUMAN: <reason>`. The tick then applies the `conductor-blocked` label to the watched item (creating the label when the repository has none) and stays silent on the conversation.
- FR-4: An item that carries the `conductor-blocked` label gets no reply. A person removes the label to resume it.
- FR-5: A closed issue and a closed or merged pull request get no reply (already the rule; it stays, and is covered by a test).
- FR-6: `--check` reports a blocked item and an item at the limit as skips with their reason. `--dry-run` obeys both rules and prints `NEEDS-HUMAN` outcomes without applying a label.
- FR-7: `docs/conductor.md`, `docs/config.md` and `CHANGELOG.md` document the change.

## Assumptions

- [AUTO] Counting: chose a marker in the comment body over a state file, because a cron checkout can be fresh and the conversation is the only shared record. A reply without the marker is not counted.
- [AUTO] Needs-a-human signal: chose a last line in the model's output that automata reads, over giving the model `gh issue edit`, because the run is read-only and must not get write access to labels.
- [AUTO] Label scope: chose the watched item itself (the issue, or the watched pull request), not the linked pull request the reply would have gone to.
- [AUTO] Label creation: chose to create `conductor-blocked` when missing, because without it the block cannot be recorded.
- [AUTO] Limit with no label: chose to log and skip without a label, so that raising the limit resumes the item.
- [AUTO] Config: chose hand-edited JSON with no `config set` key, as `conductor.watch` is.
