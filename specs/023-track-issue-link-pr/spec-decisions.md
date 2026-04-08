# Spec Decisions: Track Issue Context and Link PRs

**Branch**: `023-track-issue-link-pr` | **Date**: 2026-04-08  
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

## Planning Decisions

- **Comment ID retrieval**: Parse the comment URL from `gh issue comment` stderr output rather than using a separate API call or persistent state file. Rationale: the URL is reliably emitted by `gh` and contains everything needed (owner/repo/comment-id). Alternatives: (a) `gh api` POST with JSON response — more complex, no benefit; (b) state file — unnecessary filesystem coupling.

- **In-memory vs persistent state**: Hold the comment URL in memory during the synchronous command run rather than writing to `.automata/state.json`. Rationale: the command runs synchronously — no process restart to survive. Alternative rejected: state file adds read/write complexity and cleanup concerns.

- **New helpers in githubService.ts**: Place `editComment`, `getCurrentBranchPr`, `addClosesRefToPr`, and `addCopilotReviewer` in `githubService.ts` rather than `gitService.ts`. Rationale: maintains existing separation where `githubService` handles issue/comment operations and `gitService` handles enriched PR queries with SonarCloud data.

- **Non-fatal post-AI operations**: All post-AI linking operations (edit comment, add closes ref, add copilot reviewer) are wrapped in try/catch with stderr warnings. Rationale: these are best-effort enhancements that should never cause the command to fail after the AI has already completed its work.

- **PR body append strategy**: Read current PR body via `gh pr view`, check for existing `Closes #N`, append if missing, write back via `gh pr edit --body`. Rationale: idempotent and simple. Alternative: GraphQL mutation — overkill for this use case.
