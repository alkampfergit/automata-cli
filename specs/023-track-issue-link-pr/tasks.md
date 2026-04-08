# Tasks: Track Issue Context and Link PRs

**Branch**: `023-track-issue-link-pr` | **Date**: 2026-04-08

## Prerequisites

- Feature branch `023-track-issue-link-pr` created from `develop`
- Spec, plan, and research documents reviewed

## Story 1 — Track issue and link PR comment (P1)

### Phase: Foundational — githubService changes

- [ ] T01 P1 S1 — Modify `postComment` in `src/config/githubService.ts` to return the comment URL (parse from stderr of `gh issue comment`). Update the return type from `void` to `string | undefined`.
- [ ] T02 P1 S1 — Add `editComment(commentUrl: string, body: string): void` to `githubService.ts`. Parse owner/repo and comment ID from the URL, then call `gh api repos/{owner}/{repo}/issues/comments/{id} -X PATCH -f body="..."`.
- [ ] T03 P1 S1 — Add `getCurrentBranchPr(): { number: number; url: string } | null` to `githubService.ts`. Uses `gh pr view` on the current branch with `--json number,url`.
- [ ] T04 P1 S1 — Add `addClosesRefToPr(prNumber: number, issueNumber: number): void` to `githubService.ts`. Reads PR body via `gh pr view`, appends `Closes #N` if not present, writes back via `gh pr edit --body`.

### Phase: Foundational — Tests for githubService

- [ ] T05 P1 S1 — Write unit tests for modified `postComment` (returns comment URL from stderr).
- [ ] T06 P1 S1 — Write unit tests for `editComment` (verifies `gh api` call with correct args).
- [ ] T07 P1 S1 — Write unit tests for `getCurrentBranchPr` (found PR, no PR, error cases).
- [ ] T08 P1 S1 — Write unit tests for `addClosesRefToPr` (appends Closes #N, skips if already present).

### Phase: Integration — getReady.ts orchestration

- [ ] T09 P1 S1 — Capture comment URL from `postComment` return value in `getReady.ts`.
- [ ] T10 P1 S1 — After AI invocation (or after claim when `--no-claude`), add post-AI linking logic: call `getCurrentBranchPr()`, if PR found: `editComment()` to update "working" comment with PR link, `addClosesRefToPr()` to add issue reference.
- [ ] T11 P1 S1 — Wrap all post-AI operations in try/catch with stderr warnings (non-fatal pattern).
- [ ] T12 P1 S1 — Write unit tests for post-AI linking in getReady: PR found → edits comment + adds closes ref; no PR → skips silently.

## Story 2 — Request Copilot review (P2)

### Phase: Foundational

- [ ] T13 P2 S2 — Add `addCopilotReviewer(prNumber: number): void` to `githubService.ts`. Calls `gh pr edit <number> --add-reviewer @copilot`.
- [ ] T14 P2 S2 — Write unit test for `addCopilotReviewer`.

### Phase: Integration

- [ ] T15 P2 S2 — Add `--ask-copilot-review` option to `implementNextCommand` in `getReady.ts` (default: off).
- [ ] T16 P2 S2 — In post-AI linking block, if `--ask-copilot-review` and PR exists, call `addCopilotReviewer()`.
- [ ] T17 P2 S2 — Write unit tests: flag present + PR exists → calls reviewer; flag absent → skips; flag present + no PR → skips.

## Polish

- [ ] T18 — Update `docs/implement-next.md` with new `--ask-copilot-review` option and post-AI linking behavior.
- [ ] T19 — Update smoke test in `getReady.cmd.test.ts` to verify `--ask-copilot-review` appears in help output.
- [ ] T20 — Run `npm test && npm run lint` and fix any failures.

## Dependencies

- T05-T08 depend on T01-T04
- T09-T12 depend on T01-T04
- T13-T14 are independent of T01-T12
- T15-T17 depend on T09-T11 and T13
- T18-T20 depend on all above

## Implementation Strategy

MVP first: Complete Story 1 (T01-T12), then Story 2 (T13-T17), then Polish (T18-T20).
