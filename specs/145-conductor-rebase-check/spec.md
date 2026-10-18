# Feature Specification: conductor rebase check

**Branch**: `feature/145-conductor-rebase-check` | **Issue**: #145 (part of epic #114)

## User Story

As the operator, I want the conductor to ask the agent to rebase a watched pull request that has a merge conflict, even when the `conductor-blocked` label is on the item, so that a conflict does not stop the work until a person sees it.

## Requirements

- FR-1: Each tick runs an "always check" for each watched item before the loop-safety stop. The first (and only) always check is the rebase check. It ignores the `conductor-blocked` label and the reply limit `conductor.maxRepliesPerItem` for ordinary replies.
- FR-2: The rebase check triggers on an open pull request (a watched pull request, or an open pull request linked to a watched issue) when GitHub reports `mergeable: CONFLICTING`. `UNKNOWN` and `MERGEABLE` do not trigger; `UNKNOWN` is read again on the next tick.
- FR-3: A triggered check is a conductor turn on that pull request. The model gets the `conductor.prompts.rebase` text as its instructions and posts the request as a comment on the pull request. The agent does the rebase.
- FR-4: `conductor.prompts.rebase` has the same format as `prompts.issue` and `prompts.pr` (text, or a `.md` file in `.automata/`). The default text is: "please fetch, update the target branch then rebase the branch on the target branch, resolve conflicts, commit and push, then wait for all the checks to report ok, if some check fails, or if you have issues in sonar cloud, please fix them".
- FR-5: The rebase turns have their own counter. A rebase comment ends with the marker `<!-- automata:conductor-rebase head=<sha> -->` and not with the reply marker, so it is counted only as a rebase turn. The limit is `conductor.maxRepliesPerItem` (default 5). At the limit the check skips the item with reason `rebase-limit`.
- FR-6: The check runs at most once per head commit SHA: when a rebase comment for the current head SHA exists on the pull request, the check skips with reason `rebase-done`. A new push changes the SHA and re-arms the check.
- FR-7: If the rebase run ends with `NEEDS-HUMAN:`, the item gets the `conductor-blocked` label again, as for any other turn. The conductor also posts one short note with the rebase marker, so FR-6 holds and the next tick does not run the model again for the same SHA.
- FR-8: The check applies to watched items only. A pull request that is not watched, and not linked to a watched issue, is not rebased.
- FR-9: The check does not start while the `do-work` run lock is held (as for a Copilot turn), and it works in `--dry-run` and shows in `--check`.
- FR-10: The always checks are a list of pure functions, so another check can be added later.
- FR-11: The wizard has a `Conductor — Rebase` prompt screen. `docs/conductor.md`, `docs/config.md` and `CHANGELOG.md` (`Unreleased`) document the change. README does not change.

## Assumptions

- [AUTO] Request goes to the agent as a comment: the issue title says "post to rebase and continue", and the conductor is comment-only and read-only.
- [AUTO] Same limit value: the rebase counter uses `conductor.maxRepliesPerItem`; no new key (agreed in the issue: "same default limit").
- [AUTO] Counter state lives in the conversation (markers), as the reply counter does; no local state file.
- [AUTO] A rebase turn runs before an ordinary reply turn on the same item; the ordinary reply is decided again on the next tick.
- [AUTO] CONFLICTING is read from `gh pr view --json mergeable,headRefOid`; a missing SHA does not trigger.
