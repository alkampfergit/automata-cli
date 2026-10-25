# Feature Specification: rebase open pull requests onto their base

**Branch**: `feature/165-rebase-prs` | **Issue**: #128

## User Story

As the operator, I want `automata git rebase-prs` to bring every open pull request up to date with its base branch
and to let the configured model resolve conflicts, so a cron job keeps the pull requests mergeable without me.

## Requirements

- FR-1: `automata git rebase-prs` lists the open pull requests. `--pr <n>` selects one, `--max-prs <n>` caps how many
  are handled, `--no-fetch` skips `git fetch origin`, `--dry-run` reports what would happen and changes nothing.
- FR-2: A pull request is skipped, with a reason, when it is a draft (unless `git.rebasePrs.includeDrafts` is true),
  comes from a fork, has an author that is neither `agentUser` nor the authenticated `gh` login (an unowned branch),
  or already contains `origin/<base>` (up to date).
- FR-3: A pull request that needs a rebase is rebased in a detached `git worktree` under the temporary directory,
  with the explicit strategy of `rebaseOnto()` (`--no-reapply-cherry-picks`). The main checkout is never touched.
- FR-4: A clean rebase is pushed with `git push --force-with-lease=<branch>:<old sha> origin HEAD:refs/heads/<branch>`.
- FR-5: On a conflict the executor (`doWork.executor`, `doWork.models`, `doWork.effort`) runs in the worktree with the
  prompt `git.rebasePrs.prompt` (text or `.md` file in `.automata/`, built-in default). The prompt lists the
  conflicted files and tells the model to edit files only. Automata runs `git add` and `git rebase --continue`.
- FR-6: Automata runs `git.rebasePrs.testCommand` in the worktree after the rebase, when set. A non-zero exit blocks.
- FR-7: A pull request is blocked when the model leaves a conflict marker, when the executor fails, when the test
  command fails, or when `git.rebasePrs.maxAttempts` (default 3) resolutions are spent. Then automata runs
  `git rebase --abort`, does not push, adds the label `rebase-blocked` and posts one comment that names the reason.
  A pull request that already has the label is not commented again.
- FR-8: One failing pull request does not stop the others. The exit code is 1 when at least one was blocked or failed.
- FR-9: The command takes the `do-work` run lock for its run, so no `do-work` tick runs in parallel. When `do-work`
  holds the lock, the command exits 0 without work (`--dry-run` only reads the lock).
- FR-10: New config keys `git.rebasePrs.{prompt,maxAttempts,testCommand,includeDrafts}` with `config set
  rebase-prs-prompt|rebase-prs-max-attempts|rebase-prs-test-command|rebase-prs-include-drafts`.
- FR-11: `docs/git.md` has a `rebase-prs` section, `docs/config.md` lists the keys, `CHANGELOG.md` has a bullet under
  `Unreleased`.

## Assumptions

- [AUTO] Standalone command (the issue's suggestion), so the conductor can call it later.
- [AUTO] "Branches that automata owns" means: not a fork, and the author is `agentUser` or the authenticated login.
- [AUTO] The `do-work` lock is repository-wide, so "a branch with an active run lock" is the whole run.
- [AUTO] Each pull request is rebased onto its own base branch, `origin/<baseRefName>`.
- [AUTO] A conflicting rebase of several commits may conflict again after `--continue`; every resolution counts as
  one attempt.
- [AUTO] Out of scope: a wizard screen for the new keys, running from the `conductor`.
- [AUTO] Spec number 165: 164 is the highest in use.
