# Feature Specification: trim the oldest conversation history when the prompt exceeds the budget

**Branch**: `feature/176-trim-prompt-history` | **Issue**: #176

## User Story

As the operator, I want `do-work` to keep its prompt within a size budget, so a long discussion does not make a run
fail or exceed the context window of the model.

## Requirements

- FR-1: Before the executor starts, the prompt size is estimated in tokens (4 bytes = 1 token).
- FR-2: The budget is `doWork.maxPromptTokens` (default 100000, positive integer). `config set
  do-work-max-prompt-tokens <n>` sets it; an invalid value in the file stops the tick with a message.
- FR-3: Over budget: the oldest issue and pull-request messages are dropped first, until the prompt fits.
- FR-4: Never dropped: the frame, identifiers, new messages (the trigger) and review threads.
- FR-5: Each conversation shows a marker with the count and the date range of the omitted messages.
- FR-6: If the required part alone exceeds the budget, no run starts. The marker comment and `--dry-run` give an
  actionable message that names the setting.
- FR-7: The watermark still covers all messages, so a trimmed message cannot cause a retry loop and the trigger is
  never marked as answered without an answer.
- FR-8: `docs/do-work.md`, `docs/config.md` and `CHANGELOG.md` describe the change.

## Assumptions

- [AUTO] No separate byte limit: since #164 the prompt goes on stdin, so the 96 KiB argument limit no longer applies.
  The token estimate is byte-based, so one budget covers both.
- [AUTO] No tokenizer: the estimate is bytes / 4, because a model-specific tokenizer is not available to the CLI.
- [AUTO] The default 100000 stays below the 200k window of current models and leaves room for tool output.
- [AUTO] The wizard is not changed; the setting is reachable with `config set` and by editing the file.
