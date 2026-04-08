# PR Report: Track Issue Context and Link PRs

**Branch**: `023-track-issue-link-pr` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)

## Summary

Enhances `implement-next` to automatically link GitHub issues to pull requests. After the AI finishes, the tool detects if a PR was opened on the branch, edits the original "working" comment with the PR link, adds `Closes #N` to the PR body for auto-close on merge, and optionally requests a Copilot code review.

## What's New

- **Issue-PR linking**: After AI invocation, `implement-next` detects open PRs on the current branch, edits the "working" comment with the PR link, and appends `Closes #N` to the PR body.
- **Copilot review**: New `--ask-copilot-review` flag requests a Copilot code review via `gh pr edit --add-reviewer @copilot` when a PR exists.
- **GitHub service expansion**: `githubService.ts` gains `editComment`, `getCurrentBranchPr`, `addClosesRefToPr`, and `addCopilotReviewer` helpers.
- **Non-fatal post-AI operations**: All post-AI linking operations are best-effort — failures produce stderr warnings without affecting the exit code.

## Testing

- **Unit tests**: 11 new tests in `githubService.test.ts` covering `postComment` return value, `editComment`, `getCurrentBranchPr`, `addClosesRefToPr`, and `addCopilotReviewer`.
- **Integration tests**: 5 new tests in `getReady.cmd.test.ts` covering post-AI PR linking (PR found, no PR, copilot review flag, flag absent, non-fatal failure).
- **Smoke test**: Updated to verify `--ask-copilot-review` appears in help output.

## Notes

- Requires `gh` CLI v2.88.0+ for `--add-reviewer @copilot` support. Older versions will produce a warning on stderr when the flag is used.
- The comment URL is parsed from `gh issue comment` stderr output. If `gh` changes its output format, the URL may not be captured (gracefully degrades to no comment edit).
