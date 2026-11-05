# Trim the oldest conversation history when the prompt exceeds the budget

Closes #176

## Summary

`do-work` now keeps its prompt within a configurable token budget by leaving out the oldest conversation messages, so a long discussion no longer breaks a run.

## What's New

- Prompt budget with oldest-first trimming and an omission marker; refusal with a clear message when the required part alone is too large.
- New setting `doWork.maxPromptTokens` (default 100000) and `config set do-work-max-prompt-tokens`.
- `processItems` runs items with a recursive step (same order) to satisfy the Sonar `no-await-in-loop` rule.

## Testing

Unit tests for trimming (oldest first, trigger kept, budget met, refusal), the setting and its validation. `npm test`, `npm run lint`, `npm run typecheck` and `npm run sonar:local` pass.
