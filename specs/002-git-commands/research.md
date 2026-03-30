# Research: Git Workflow Commands

**Branch**: `002-git-commands` | **Date**: 2026-03-30

All technical decisions for this feature were made autonomously based on the existing codebase patterns and project constitution. Full decision records are in `plan.md` Phase 0 section.

## Summary of Decisions

| Decision | Chosen Approach | Key Rationale |
|----------|----------------|---------------|
| Subprocess invocation | `spawnSync` from `node:child_process` | Explicit exit code access, no new dependencies |
| PR detection | `gh pr view --json number,title,state,url` | Uses gh CLI auth/API handling, current branch by default |
| Upstream tracking check | `git ls-remote --exit-code --heads origin <branch>` | Queries remote in real-time, documented exit code 2 for no match |
| Module structure | `src/commands/git.ts` + `src/git/gitService.ts` | Mirrors existing `config.ts` + `configStore.ts` pattern |

## Autonomous Decisions

- [AUTO] No new runtime npm dependencies: `node:child_process` is a Node.js built-in — per Constitution IV.
- [AUTO] Service functions mocked in unit tests via `vi.mock` — consistent with existing test patterns.
- [AUTO] `finish-feature` only proceeds on `merged` state (not merely `closed`) — prevents accidental cleanup of rejected PRs.
