# Feature Specification: conductor runs the model and posts the reply

**Branch**: `feature/121-conductor-run-model` | **Issue**: #121 (part of epic #114)

## User Story

As the operator, I want the conductor to run Claude or Codex on a watched item that waits for an allowed user, and to
post the model's reply as a comment, so the agent is not left waiting.

## Requirements

- FR-1: For each watched item the tick applies the reply rule; when a conversation needs a reply it runs the model once.
- FR-2: The run is read-only: Claude is limited to reading and to `gh`/`git` lookups and comments; Codex uses its read-only sandbox.
- FR-3: New keys `conductor.executor` (default `claude`), `conductor.models` and `conductor.effort`, both keyed per executor.
- FR-4: The prompt always tells the model to post with `gh issue|pr comment <n> --body-file -`, and that stdout is discarded.
- FR-5: After the run the tick re-reads the conversation. No new comment from the conductor's account means the run posted nothing: error on stderr, exit 1.
- FR-6: v1 is comment only: no approve, no merge.
- FR-7: `config set conductor-executor|conductor-model|conductor-effort`; docs in `docs/conductor.md` and `docs/config.md`.

## Assumptions

- [AUTO] Posting: chose `--body-file -` (stdin) because a read-only run cannot write a body file.
- [AUTO] Detection: chose a before/after comparison of the account's own comments because stdout is discarded and #115's transcript recovery applies to `do-work` only.
- [AUTO] One run per item per tick, on the first conversation that needs a reply (issue, then pull requests).
- [AUTO] Codex: chose `--sandbox read-only` although it may block `gh`; the posted-nothing check reports it instead of hiding it.
- [AUTO] Wizard: chose no wizard screens for the new keys; `config set` is enough for v1.
- [AUTO] Repeat runs on an item whose run posted nothing are left to loop safety (#122).
- [AUTO] An item that cannot be read is skipped with a warning, as the prune keeps it.
