# Implementation Plan: Track Issue Context and Link PRs

**Branch**: `023-track-issue-link-pr` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/023-track-issue-link-pr/spec.md`

## Summary

Enhance `implement-next` to capture the comment ID when posting "working", then after AI invocation finishes, detect if a PR exists on the current branch, edit the comment with the PR link, add `Closes #N` to the PR body, and optionally request Copilot review via `--ask-copilot-review`.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)  
**Primary Dependencies**: commander.js, `gh` CLI via `spawnSync`  
**Storage**: N/A (in-memory comment ID, no persistent state)  
**Testing**: vitest with mocked `spawnSync`  
**Target Platform**: Node.js LTS (18+)  
**Project Type**: CLI  
**Performance Goals**: N/A (single-shot CLI command)  
**Constraints**: All post-AI `gh` operations must be non-fatal (warn on stderr, don't change exit code)  
**Scale/Scope**: Single command enhancement

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. CLI-First Design**: New `--ask-copilot-review` flag follows POSIX conventions. No new commands added. PASS.
- **II. TypeScript Strictness**: All new code will use strict types, no `any`. PASS.
- **III. Single Responsibility**: Changes are scoped to `getReady.ts` (orchestration) and `githubService.ts` (GitHub API). PASS.
- **IV. npm Distribution**: No new dependencies. PASS.
- **V. Simplicity**: In-memory comment ID avoids filesystem state. Reuses existing `gh` patterns. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/023-track-issue-link-pr/
├── spec.md
├── plan.md              # This file
├── research.md
├── pr-report.md
├── spec-decisions.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── commands/
│   └── getReady.ts          # Add post-AI linking logic + --ask-copilot-review flag
├── config/
│   └── githubService.ts     # Modify postComment to return comment URL; add editComment, addPrClosesRef, addCopilotReviewer, getCurrentBranchPrNumber
└── git/
    └── gitService.ts        # (no changes — PR detection for this feature uses lightweight gh calls in githubService)

tests/unit/
└── getReady.cmd.test.ts     # Add tests for new post-AI behavior
```

**Structure Decision**: All changes fit within existing single-project layout. `githubService.ts` gains new GitHub API helper functions. `getReady.ts` gains post-AI orchestration logic.

## Architecture

### Flow after AI invocation completes

```
1. postComment(issueNumber, "working") → returns commentUrl
2. [AI runs or --no-claude skips AI]
3. detectPr(currentBranch) → prNumber | null
4. if prNumber:
   a. editComment(commentUrl, "working on PR #N <url>")
   b. addClosesRef(prNumber, issueNumber)  → gh pr edit --body append "Closes #N"
   c. if --ask-copilot-review: addCopilotReviewer(prNumber)
```

### Key Design Decisions

1. **Comment URL parsing**: `gh issue comment` writes the comment URL to stderr. We capture it and extract the comment API path.
2. **No state file**: The comment URL is held in memory between the `postComment` call and the post-AI linking. No `.automata/state.json` needed.
3. **PR body append**: Use `gh pr view --json body` to read current body, append `\n\nCloses #N`, then `gh pr edit --body`.
4. **Non-fatal pattern**: All post-AI operations wrapped in try/catch with stderr warnings.

## Complexity Tracking

No constitution violations.
