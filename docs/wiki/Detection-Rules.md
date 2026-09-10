# Detection rules

The exact rules `do-work` uses to decide what to do. These live in one pure, unit-tested module, so what follows is the whole story, not a summary.

## Rule 1 — The authorization filter

A message is only considered when its author is in `allowedUsers` or is `agentUser`. Everything else is dropped **before** any other rule runs: it cannot trigger a turn, and it never appears in a prompt.

Logins are compared case-insensitively (GitHub logins are case-insensitive).

This is also why bot reviewers do not drive turns. They are not in `allowedUsers`, so they are simply invisible to `do-work`.

## Rule 2 — The agent boundary

For each surface, the boundary is the **newest message authored by `agentUser`** on that surface.

A message is **new** when all three hold:

1. its author is in `allowedUsers`;
2. its author is not `agentUser`;
3. its timestamp is **strictly** newer than the boundary.

If the agent has never spoken on the surface, every authorized message is new.

Two consequences worth stating explicitly:

- **The agent can never trigger itself.** Condition 2 excludes agent messages even when the agent account is also listed in `allowedUsers`.
- **A tie is not new.** Strict comparison means the marker comment the agent posts cannot retrigger the very turn that produced it.

The issue **description** is excluded from the boundary calculation, so an issue opened by the agent does not block itself from ever being processed.

## Rule 3 — The unresolved-thread rule

A review thread needs an answer when:

- it is **not resolved**, **and**
- its **newest** comment is from an authorized account that is not the agent.

The second half is what matters. If the agent has answered, the thread is answered — even though it is still unresolved — because resolving is the reviewer's action, not the agent's. Treating "unresolved" alone as actionable would make every thread retrigger a turn on every tick, forever.

"The agent has answered" means an agent message newer than the thread's newest authorized comment **anywhere on the pull request**, not only inside the thread. The prompt gives the model a file, a line and the comment's URL, but nothing guarantees an in-thread reply is achievable, and the shipped prompt explicitly permits answering on the conversation. Judging in-thread alone left such a thread actionable forever.

Timestamps for review comments come from when the review was **submitted**, not when the comment was drafted: GitHub stamps a pending review's comments as they are written, so a review drafted over twenty minutes would otherwise look older than an answer posted in the middle of it, and the whole review would be marked answered.

"Newest" is decided **after** Rule 1 has dropped the unauthorized comments, not before. Otherwise a bot commenting in the thread after a maintainer's request would make the bot the newest author and silently suppress that request. The filtered comments are also what reach the prompt, so bot text never appears there.

A resolved thread never counts, even if it has a new authorized comment.

## Rule 4 — The pull-request-existence rule

The turn kind is decided by one observable fact: does an **open** pull request declare a closing reference to this issue?

The link is GitHub's `closingIssuesReferences`, which is what a `Closes #N` / `Fixes #N` in a pull request body produces (and what the GitHub UI's manual linking produces). `do-work` resolves it for every candidate issue in a single GraphQL query.

## Rule 5 — The merged-pull-request rule

A linked pull request that is **merged or closed** is treated as **no pull request**. The branch has landed or been abandoned, so the model must not push to it; a discussion turn lets the humans decide what comes next.

## Rule 6 — The orphan pull-request rule

An **open pull request that declares no closing reference to an issue of this repository** is not reachable through Rules 4 and 5 at all — those start from an issue. It is handled by a second pass, and the rule there is Rules 1–3 with the pull request as the only surface:

- it must match the same `issueDiscoveryTechnique` / `issueDiscoveryValue`, read off the pull request (its labels, its assignees, or its title);
- an authorized account must have left a message on it that the agent has not answered.

Nothing else triggers it. There is no "first sighting" turn and no re-trigger on a head-SHA change, so a bot's own pull request body and commits — the author is not in `allowedUsers` — never start a run. The label is therefore not what starts work; it only bounds how many pull-request conversations a tick fetches.

A pull request closing only *another* repository's issue closes nothing here, so it is an orphan here. A pull request that gains a closing reference stops being one, and this pass hands it back to the issue pass rather than answering with the wrong prompt.

The two passes are disjoint by construction: a pull request is either in the issue-keyed map or in the orphan list, never both.

## Rule 7 — One turn per issue

If both the issue **and** its open pull request have new messages, that is **one** build turn whose prompt carries both sets. Two turns would mean two model runs writing to the same branch.

---

## The decision table

| Issue | Linked open PR | New issue messages | New PR messages / actionable threads | Result |
|---|---|---|---|---|
| closed | — | — | — | skip `issue-closed` |
| open | none | ≥ 1 | — | **`issue-discuss`** on the base branch |
| open | none | 0 | — | skip `no-new-messages` |
| open | open PR | any | ≥ 1 | **`pr-work`** on the PR's head branch |
| open | open PR | ≥ 1 | 0 | **`pr-work`** on the PR's head branch (issue messages carried into the prompt) |
| open | open PR | 0 | 0 | skip `no-new-messages` |
| open | only merged/closed PRs | ≥ 1 | — | **`issue-discuss`** on the base branch |

For a pull request that closes no issue of this repository:

| PR state | Matches the discovery filter | New PR messages / actionable threads | Result |
|---|---|---|---|
| open | no | — | not a candidate; nothing is fetched for it |
| open | yes | ≥ 1 | **`pr-orphan`** on the PR's head branch |
| open | yes | 0 | skip `no-new-messages` |
| open, fork or protected head | yes | — | skip `unsafe-pr-branch` |
| merged / closed | — | — | skip `pr-closed` |
| linked since the plan was built | — | — | skip `pr-linked` |
| head branch already taken this tick | yes | ≥ 1 | skip `branch-busy` |

The branch refusals are decided before the messages are read, so a fork or a protected head reports `unsafe-pr-branch` whether or not anything new was said on it — never `no-new-messages`.

`branch-busy` is what keeps two build turns off one checkout: GitHub allows several open pull requests from one head branch to different bases, so the two passes are disjoint as pull requests but not as branches. The first item in tick order — issues before orphans — keeps the branch; the rest wait for the next tick.

When several open pull requests close the same issue, the most recently updated one is used and the others are named in the prompt and the work plan.

---

## Seeing the rules applied

`--dry-run` prints the decision for every candidate issue with its reason, and changes nothing:

```console
$ automata do-work --dry-run
Work plan (3 of 6 candidates need an answer):
  #42 issue-discuss on develop — 1 new issue message, no open pull request, will assign the issue to the agent
  #43 pr-work on feature/043-x — 1 unresolved review thread on pull request #58
  #44 nothing to do — nothing new since the agent's message at 2026-09-08T11:02:00Z
  #45 nothing to do — no messages from authorized accounts
  PR #61 pr-orphan on dependabot/npm_and_yarn/lodash-4.17.21 — 1 new pull request message on pull request #61 (no linked issue), pull request not claimed (orphan pass)
  PR #62 nothing to do — no messages from authorized accounts on pull request #62
```

After the plan, `--dry-run` prints a summary and the exact command it would launch for each item — including the fully assembled prompt — so you can see precisely what the model would receive before spending anything. `--json` gives the same information as data, including each item's `turn`, `branch`, `issue`, `pr`, `needsAssignment` and `skipReason`, plus the argv and prompt under `runs`. An orphan pull-request entry has `issue: null`.
