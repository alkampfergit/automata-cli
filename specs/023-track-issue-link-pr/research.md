# Research: Track Issue Context and Link PRs

**Branch**: `023-track-issue-link-pr` | **Date**: 2026-04-08

## Research Questions

### R1: How does `gh issue comment` return the comment identifier?

**Finding**: `gh issue comment <number> --body "text"` writes the newly created comment's URL to **stderr** (e.g., `https://github.com/owner/repo/issues/42#issuecomment-123456`). The numeric ID (`123456`) can be extracted from this URL.

**Decision**: Parse the comment URL from stderr output of `gh issue comment`.
**Rationale**: This avoids a separate API call to list comments. The URL is reliably output by `gh`.
**Alternatives considered**: (a) Using `gh api` to post comments with JSON response — adds complexity for no gain. (b) Persisting to a state file — unnecessary since the command runs synchronously.

### R2: How to edit a GitHub issue comment via `gh`?

**Finding**: `gh api repos/{owner}/{repo}/issues/comments/{id} -X PATCH -f body="new text"` edits a comment. The `{owner}/{repo}` can be parsed from `gh repo view --json nameWithOwner` or from the git remote URL.

**Decision**: Use `gh api` with PATCH to edit comments, extracting owner/repo from the comment URL itself.
**Rationale**: The comment URL already contains `github.com/{owner}/{repo}/...`, so no extra API call needed.

### R3: How to append `Closes #N` to a PR body?

**Finding**: `gh pr view <number> --json body -q .body` gets the current body. Then `gh pr edit <number> --body "<updated body>"` sets it. We append `\n\nCloses #N` only if it's not already present.

**Decision**: Read-then-append approach via `gh pr view` + `gh pr edit`.
**Rationale**: Simple and idempotent (checks for existing `Closes #N` before appending).

### R4: How to detect if the current branch has an open PR?

**Finding**: `gh pr view <branch> --json number,url` returns the PR info or exits non-zero with "no pull requests found". This is exactly the pattern used in `getPrInfoGh` in `gitService.ts`.

**Decision**: Add a lightweight `getCurrentBranchPr` function in `githubService.ts` that returns `{ number, url } | null`.
**Rationale**: Reuse the `run()` helper already in `githubService.ts`. Don't reuse `getPrInfoGh` because it fetches heavy data (SonarCloud, status checks) we don't need.

### R5: How to add Copilot as a reviewer?

**Finding**: `gh pr edit --add-reviewer @copilot` (available since gh v2.88.0). This is a simple `gh` invocation.

**Decision**: Direct `gh pr edit` call wrapped in non-fatal try/catch.
**Rationale**: Simplest approach. Older `gh` versions will fail gracefully.

## Autonomous Decisions

- Chose in-memory comment URL over persistent state file because the command runs synchronously — no need to survive process restarts.
- Chose `githubService.ts` for new GitHub helpers rather than `gitService.ts` to maintain the existing separation of concerns (githubService = issue/comment ops, gitService = git/PR ops with enrichment).
