# Phase 1 Data Model: `do-work` pre-flight repository hygiene

**Feature**: `feature/032-do-work-repo-hygiene` | **Date**: 2026-09-10

There is no persisted data. The entities below are the in-memory shapes the pre-flight produces
and the tick reports; the authoritative state is the git checkout itself.

---

## `HygieneOptions` (input to `runRepoHygiene`)

| Field | Type | Meaning |
|---|---|---|
| `baseBranch` | `string` | The branch to fast-forward and to measure reachability against. Never committed to, pushed or deleted. |
| `protectedBranches` | `string[]` | Names that are never deletion candidates, from `doWork.protectedBranches`. |
| `dryRun` | `boolean` | When true every step reports what it *would* do and mutates nothing. |
| `log` | `(message: string) => void` | Progress sink, so the caller keeps ownership of the stdout/stderr split. |

---

## `RescueOutcome` (discriminated union on `kind`)

| Variant | Fields | Meaning |
|---|---|---|
| `clean` | — | The tree had no uncommitted changes (run-lock path excluded). Nothing was done. |
| `rescued` | `branch: string`, `createdBranch: boolean`, `pr: number \| null`, `prUrl: string \| null`, `prCreated: boolean` | Changes were committed to `branch` and pushed. `createdBranch` distinguishes a new `rescue/*` branch from committing onto the branch already checked out. `prCreated` is false when an open pull request already existed. |
| `would-rescue` | `branch: string`, `createdBranch: boolean` | `--dry-run`: this is what would have happened. |
| `failed` | `step: "branch" \| "stage" \| "commit" \| "push" \| "pr"`, `detail: string` | The rescue stopped at `step`. Nothing was discarded; the tree is still dirty. |

**Invariant**: `branch` is never `baseBranch`. `kind: "failed"` never implies data loss — every
step is additive (create branch, stage, commit, push, open pull request).

---

## `PruneCandidate`

| Field | Type | Meaning |
|---|---|---|
| `branch` | `string` | Local branch name. |
| `openPr` | `number \| null` | The open pull request for this head, if any. |
| `mergedPr` | `number \| null` | A merged pull request for this head, if any. Checked before the count. |
| `unmergedCommits` | `number` | `git rev-list --count <base>..<branch>`. Not read when `mergedPr` is set. |

Only branches that survived the exclusion filter (not `baseBranch`, not the current branch, not
in `protectedBranches`, absent from `origin`) ever become candidates.

---

## `PruneOutcome` (discriminated union on `kind`)

| Variant | Fields | Meaning |
|---|---|---|
| `deleted` | `branch: string` | No open pull request, and either a merged one or `unmergedCommits === 0`. |
| `would-delete` | `branch: string` | `--dry-run` equivalent of `deleted`. |
| `kept` | `branch: string`, `reason: "open-pr" \| "lookup-failed" \| "delete-failed"`, `detail: string` | Retained. `lookup-failed` and `delete-failed` are degraded; `open-pr` is not. |
| `rescued` | `branch: string`, `pr: number \| null`, `prUrl: string \| null` | No merged pull request and `unmergedCommits > 0`: pushed and given a draft pull request, and kept. `pr` is null when the push succeeded but the pull request could not be opened. |
| `would-rescue` | `branch: string`, `unmergedCommits: number` | `--dry-run` equivalent of `rescued`. |

---

## `HygieneReport` (output of `runRepoHygiene`)

| Field | Type | Meaning |
|---|---|---|
| `rescue` | `RescueOutcome` | Step 1. |
| `base` | `{ ok: true } \| { ok: false; step: "checkout" \| "pull"; detail: string }` | Step 2. |
| `prunes` | `PruneOutcome[]` | Step 3, in the order the branches were listed. |
| `degraded` | `boolean` | True when any step failed. Derived, not set independently. |

`degraded` is true when `rescue.kind === "failed"`, or `base.ok === false`, or any prune outcome
is `kept` with reason `lookup-failed` or `delete-failed`, or the remote listing failed.

---

## State transitions the pre-flight can cause

```text
dirty tree, HEAD = base        → new rescue/* branch, committed, pushed, draft PR, clean tree
dirty tree, HEAD = other       → committed on HEAD, pushed, draft PR if none open, clean tree
dirty tree, HEAD detached      → new rescue/* branch, committed, pushed, draft PR, clean tree
clean tree                     → unchanged
any tree                       → HEAD = base branch at origin's tip

local branch, on origin              → unchanged
local branch, absent, open PR        → unchanged
local branch, absent, merged PR      → deleted (count not consulted)
local branch, absent, no merged PR,
  0 commits outside base             → deleted
local branch, absent, no merged PR,
  >0 commits outside base            → pushed + draft PR, kept
local branch, absent, lookup failed  → unchanged
base / current / protected branch    → unchanged
```

No transition removes a commit whose change is not already in the base branch — proven either by
reachability or by a merged pull request — and no transition modifies the base branch other than
fast-forwarding it.
