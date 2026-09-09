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

## Rule 6 — One turn per issue

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

When several open pull requests close the same issue, the most recently updated one is used and the others are named in the prompt and the work plan.

---

## Seeing the rules applied

`--dry-run` prints the decision for every candidate issue with its reason, and changes nothing:

```console
$ automata do-work --dry-run
Work plan (2 of 4 issues need an answer):
  #42 issue-discuss on develop — 1 new issue message, no open pull request, will assign to the agent
  #43 pr-work on feature/043-x — 1 unresolved review thread on pull request #58
  #44 nothing to do — nothing new since the agent's message at 2026-09-08T11:02:00Z
  #45 nothing to do — no messages from authorized accounts
```

After the plan, `--dry-run` prints a summary and the exact command it would launch for each item — including the fully assembled prompt — so you can see precisely what the model would receive before spending anything. `--json` gives the same information as data, including each item's `turn`, `branch`, `pr`, `needsAssignment` and `skipReason`, plus the argv and prompt under `runs`.
