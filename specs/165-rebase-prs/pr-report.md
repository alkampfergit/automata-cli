# rebase open pull requests onto their base

**Branch**: `feature/165-rebase-prs` | **Date**: 2026-10-25 | **Spec**: [spec.md](specs/165-rebase-prs/spec.md)

Closes #128

## Summary

`automata git rebase-prs` brings every open pull request up to date with its base branch. A clean rebase is pushed with a lease. On a conflict the configured model resolves it; if that fails the branch stays as it was and the pull request is labelled `rebase-blocked`.

## What's New

- `automata git rebase-prs` (`--dry-run`, `--no-fetch`, `--pr`, `--max-prs`): rebases each open pull request that is behind its base in a detached temporary worktree, with the `do-work` rebase strategy, and pushes with an explicit `--force-with-lease`.
- Conflicts go to the configured executor (`doWork.executor`, `models`, `effort`) in the worktree; automata runs `git add` and `git rebase --continue`.
- A blocked pull request (marker left, executor or test failure, attempt limit) is left unchanged, labelled `rebase-blocked` and commented once.
- Skips forks, drafts, branches not owned by `agentUser` or the `gh` login, and up-to-date pull requests. Takes the `do-work` run lock.
- Config `git.rebasePrs.{prompt,maxAttempts,testCommand,includeDrafts}` and `config set git-rebase-prs-*`.
- `runClaude` / `runCodex` accept `cwd`; `gitService` exports `REBASE_STRATEGY_ARGS`.
- `docs/git.md`, `docs/config.md`, `CHANGELOG.md` updated.

## Testing

- Unit: skip rules, marker scan, prompt and comment text, exit codes, `config set` keys.
- Integration, real `git` with a bare `origin`: clean rebase, dry run, model-resolved conflict, marker left, executor failure, test failure, attempt limit, lease race, per-pull-request isolation, `--max-prs`.
- Not run: a live model and `gh` against GitHub.

## Notes

- No wizard screen for the new keys.
- Only branches whose author is `agentUser` or the `gh` login are rebased; there is no flag to include other authors yet.
- `sonar:local` still reports a control-character rule in `git.ts` and two `no-await-in-loop` findings in `gitService.ts`. They are old lines that appear whenever the file changes, and are kept.
