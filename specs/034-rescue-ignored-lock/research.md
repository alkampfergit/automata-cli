# Research: Rescue survives an ignored run lock

**Branch**: `feature/034-rescue-ignored-lock` | **Date**: 2026-09-15

## The defect, reproduced

A scratch repository with `.automata/automata.lock` in `.gitignore`, one modified tracked file and
one untracked file:

```
$ git add -A -- . ':(exclude).automata/automata.lock'
The following paths are ignored by one of your .gitignore files:
.automata/automata.lock
hint: Use -f if you really want to add them.
exit=1

$ git add -A -- .        # same tree, no exclusion pathspec
exit=0
```

Two things matter here:

1. `git add -A` on its own never complains about an ignored path — it silently skips it. The error is
   produced *only* because the path is named explicitly, and `:(exclude)` magic does not spare it from
   git's "you named an ignored path" check.
2. The failing command still stages everything it was supposed to stage. Git reports exit 1 while the
   index is exactly what the caller wanted, so `stageAllExcept` returns `ok: false` for work that
   succeeded — which is why the rescue then abandoned a branch it had already created.

## Decision 1 — drop exclusions git already ignores

**Decision**: before building the pathspec, ask `git check-ignore -q -- <path>` for each exclusion and
drop the ones it answers 0 for. When nothing is left, issue the unqualified `git add -A`.

**Rationale**: `git check-ignore`'s exit status is precisely the predicate we need. Measured:

| path | state | `check-ignore -q` |
|---|---|---|
| `.automata/automata.lock` | ignored, untracked | 0 |
| `.automata/automata.lock` | ignored **and tracked** | 1 |
| `tracked.txt` | not ignored | 1 |
| `nope/nothing.txt` | absent, not ignored | 1 |

The tracked row is the safety property: git consults the index by default, so a lock the repository
actually tracks keeps its exclusion and is never swept into the rescue commit. An ignored, untracked
lock cannot be staged by `git add -A` in the first place, so dropping its exclusion changes nothing
except the exit status.

**Alternatives considered**:

- *`git add -A` with no pathspec, always* — rejected: in a checkout that does not gitignore the lock
  (the common case the exclusion was written for) it would commit a pid file and leave the next tick's
  tree dirty.
- *Treat the "paths are ignored" stderr as success* — rejected: string-matching git's advice output is
  locale- and version-fragile, and it would mask genuine ignored-path errors from other exclusions.
- *`git add -A --` then `git restore --staged <lock>`* — rejected: two mutations where one suffices,
  and it briefly stages the lock.
- *`-f` / `--force`* — rejected: it does the opposite of what is wanted.

## Decision 2 — stage before creating the recovery branch

**Decision**: reorder `rescueUncommittedChanges` to stage first and create the branch only once
staging has succeeded.

**Rationale**: the index is branch-independent, so the order is free; `git checkout -b` at the same
commit carries the staged index onto the new branch. Doing it in this order means a staging failure
produces no branch at all, which removes the "the log named a branch that does not exist" symptom at
the source rather than compensating for it later.

**Alternatives considered**:

- *Delete the branch when staging fails* — rejected: a cleanup path that runs exactly when something
  has already gone wrong is the worst place to put a `git branch -D`.
- *Leave the order alone and rely on prune protection only* — rejected: it leaves an empty branch in
  the checkout after every failed rescue.

## Decision 3 — protect the rescue's branch from the same tick's prune

**Decision**: `runRepoHygiene` passes the rescue's branch name (whenever the rescue named one — rescued,
would-rescue or failed) into the prune phase's untouchable set.

**Rationale**: the prune rules are correct and must not be weakened; the only branch at risk is the one
this tick just made, which by construction has no remote yet. Protecting it for one tick costs nothing:
if it is genuinely empty and abandoned, the *next* tick prunes it under the normal rules.

**Alternatives considered**:

- *Refuse to delete any branch matching `rescue/`* — rejected: it would make every rescue branch
  immortal, including the ones whose pull requests were merged.
- *Run prune before rescue* — rejected: the documented ordering exists so a branch whose commits were
  just pushed is no longer a candidate.

## Decision 4 — report pre-flight causes on the per-item skip

**Decision**: add `describePreflightFailures(report)` to the hygiene module, returning zero, one or two
human-readable causes ("rescue failed at the stage step: …", "base pull failed: …"), and append them to
the per-item skip line and to the item's recorded detail when the item is skipped.

**Rationale**: the two failures are already modelled separately (`RescueOutcome` and `BaseOutcome`); all
that is missing is carrying them to where the operator reads the consequence. Appending keeps
`PrepareFailureReason` a closed union — it is consumed by the JSON output and the operation log, so
widening it would be a breaking change for what is a reporting fix.

**Alternatives considered**:

- *A new `preflight-failed` reason* — rejected, as above.
- *Print the causes once, after the plan* — rejected: the reported run shows operators read the
  per-item lines; a banner further up is exactly what was missed the first time.

## Decision 5 — no automatic recovery for a diverged base branch

**Decision**: behaviour unchanged; document the operator recovery in `docs/do-work.md`.

**Rationale**: `pull --ff-only` refusing a diverged base branch is the module's stated rule — an
unattended tool must not resolve it with a merge, a rebase or a reset. The reported case ("the local
commit is an unwanted generated change") is precisely a judgement only a human can make.

**Alternatives considered**:

- *Auto-reset the base branch to `origin` when the local-only commits are automata's own* — rejected:
  `resetToForcePushedRemote` already exists for pull-request branches where the condition can be proven
  safe; the base branch has no equivalent proof and the blast radius is the whole repository.

## Autonomous Decisions

All five decisions above were taken without user input, using the reproduction in this document, the
existing module contracts in `src/git/repoHygiene.ts` and `src/git/gitService.ts`, and the
constitution's simplicity principle. They are recorded in `spec-decisions.md` for review.
