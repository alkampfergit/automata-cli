# Spec Decisions: Get PR Open Comments

**Branch**: `006-get-pr-comments`
**Date**: 2026-03-31
**Spec**: [specs/006-get-pr-comments/spec.md](spec.md)
**Plan**: [specs/006-get-pr-comments/plan.md](plan.md)
**Research**: [specs/006-get-pr-comments/research.md](research.md)

## Planning Decisions

- **GitHub data source**: Use `gh pr view <branch> --json reviewThreads`. **Rationale**: Single CLI call that returns all thread data including `isResolved` flag; consistent with how `get-pr-info` uses `gh pr view --json statusCheckRollup`. **Alternatives considered**: GitHub REST API (`/pulls/{pr}/comments`) — does not group by thread or expose `isResolved`; GraphQL via `gh api graphql` — adds parsing complexity with no benefit for this use case.

- **Definition of "open comment"**: Thread with `isResolved === false` (including outdated-but-unresolved threads). **Rationale**: Matches GitHub's own unresolved count behaviour; errs on the side of completeness so no reviewer feedback is silently hidden. **Alternatives considered**: Exclude outdated threads — would hide potentially actionable feedback.

- **JSON shape**: One entry per unresolved thread representing only the first (top-level) comment. **Rationale**: Keeps output concise; the root comment captures the reviewer's intent; replies are context, not new feedback. **Alternatives considered**: Include all reply bodies — adds significant volume for active threads.

- **Azure DevOps**: Not supported; command exits with code 1 when `remoteType === "azdo"`. **Rationale**: `azdo pr status --json` returns no review thread data; direct REST API calls would require PAT management, violating the simplicity principle. Gap documented in `docs/azdo-gap.md` (Gap #3). **Alternatives considered**: Direct Azure DevOps REST API — out of scope per constitution.

- **Project structure**: Additive only — new function in `src/git/gitService.ts`, new command in `src/commands/git.ts`, new tests in `tests/unit/git.cmd.test.ts`. **Rationale**: Feature fits naturally into the existing flat module layout with no new files or directories needed in `src/`. **Alternatives considered**: Separate module file — unnecessary abstraction for one function.
