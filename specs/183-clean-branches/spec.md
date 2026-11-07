# Feature Specification: clean-branches command

**Branch**: `feature/183-clean-branches` | **Issue**: #183

## User Story

As a maintainer, I want one command that lists the stale branches of my repository and removes them, so that old
local branches and the remote branches of finished pull requests do not pile up.

## Requirements

- FR-1: `automata git clean-branches` runs `git fetch --prune origin` first, so "no remote branch" is accurate.
- FR-2 (local phase): a local branch that has no `origin/<name>` branch is deleted with `git branch -D`.
- FR-3 (remote phase): a branch on `origin` is deleted with `git push origin --delete <name>` only when it has no
  open pull request and at least one closed or merged pull request. A branch that never had a pull request is kept.
- FR-4: Pull requests from forks are ignored. Only pull requests whose head branch is in this repository count.
- FR-5: These branches are never deleted, in both phases: the current branch, the trunk branch (`git.trunkBranch` or
  the detected trunk), `develop`, `master` and `main`.
- FR-6: A local branch with commits that no `origin` branch has gets a warning in the listing. It is still deleted.
- FR-7: The command prints the full plan first, one line per branch with the action and the reason. Then it asks for
  confirmation. `--yes` skips the question. Without `--yes` and without a terminal, nothing is deleted and the
  command exits 1.
- FR-8: `--dry-run` prints the plan and changes nothing. `--local-only` runs the local phase only. `--remote-only`
  runs the remote phase only. The two phase flags cannot be combined.
- FR-9: Exit code 0 when the run is complete. Exit code 1 when a deletion fails, when a pull request lookup fails, or
  on a precondition error. A failure does not stop the other branches.
- FR-10: When the remote cannot be reached, nothing is deleted.

## Edge Cases

- `origin` lists no branch: the local phase deletes nothing (unknown is not "absent").
- A branch name has slashes (`feature/x`): handled as one name.
- A remote branch whose pull request lookup fails: kept, reported, exit code 1.
- A local branch deleted in the local phase and the same name on the remote: not possible; the local phase only
  takes branches that are absent on the remote.
- Remote branches deleted in the remote phase leave local branches behind. The next run removes them.

## Clarifications

- Q: Delete remote branches that never had a pull request? → A: No, keep them. [issue #183, owner said "ok"]
- Q: Delete local branches with unpushed commits? → A: Yes, with a warning. [issue #183, owner said "ok"]
- Q: Fork pull requests? → A: Ignored. [issue #183, owner said "ok"]
- Q: One prompt or one per phase? → A: One, after the whole plan is shown. [AUTO: the phases do not depend on each other]
- Q: Azure DevOps? → A: Rejected with a message when `remoteType` is `azdo`. [AUTO: the remote phase uses `gh`; a command built on `gh` rejects an explicit `azdo` (see `docs/azdo-gap.md`)]

## Assumptions

- [AUTO] The `origin` remote is the only remote.
- [AUTO] A pull request is "closed" when `gh` reports `CLOSED` or `MERGED`.
- [AUTO] Pull request lookups run once per remote branch; there is no cache.
- [AUTO] The local phase never touches a branch that is checked out in another worktree; `git branch -D` refuses it
  and the failure is reported.

## Success Criteria

- SC-1: A repository with stale branches is clean after one run with `--yes`.
- SC-2: `--dry-run` leaves every branch in place.
- SC-3: The protected branches survive every run.
