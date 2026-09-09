# PR Report: Check Issue For New Messages

**Branch**: `feature/029-check-issue-messages`
**Date**: 2026-09-09
**Spec**: [specs/029-check-issue-messages/spec.md](../../specs/029-check-issue-messages/spec.md)

## Summary

Adds `automata execute-prompt check-issue <issue-number>`, which reads a GitHub issue and decides whether one of the configured allowed users has posted a message since the agent's own last run. When one has — or when `--force` is passed — it posts a short marker comment as the agent account and launches Claude or Codex with a configurable prompt containing the issue number, title, URL and the conversation filtered down to the allowed users and the agent. This turns a maintainer's reply on an issue into an agent run without anyone having to read the thread, and it is safe to invoke repeatedly because the boundary between "already handled" and "new" is stored on the issue itself rather than in local state.

## What's New

- **[Placeholder — completed in Phase 7]**

## Testing

- **[Placeholder — completed in Phase 7]**
