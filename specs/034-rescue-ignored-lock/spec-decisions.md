# Spec Decisions: Rescue survives an ignored run lock, and pre-flight failures are reported separately

**Branch**: `feature/034-rescue-ignored-lock`
**Date**: 2026-09-15
**Spec**: [specs/034-rescue-ignored-lock/spec.md](../../specs/034-rescue-ignored-lock/spec.md)
**Plan**: [specs/034-rescue-ignored-lock/plan.md](../../specs/034-rescue-ignored-lock/plan.md)
**Research**: [specs/034-rescue-ignored-lock/research.md](../../specs/034-rescue-ignored-lock/research.md)

## Planning Decisions

- **Detecting an already-ignored exclusion**: run `git check-ignore -q -- <path>` per exclusion and drop the
  ones it answers 0 for. **Rationale**: its exit status already means "matched by `.gitignore` *and* not
  tracked", which is exactly the predicate needed — a tracked lock keeps its exclusion and is never swept
  into the rescue commit, while an ignored untracked lock could not have been staged by `git add -A`
  anyway. **Alternatives considered**: always dropping the pathspec (would commit a pid file in checkouts
  that do not ignore the lock); string-matching git's "the following paths are ignored" advice (locale- and
  version-fragile, and would mask genuine errors); staging everything then `git restore --staged` the lock
  (two mutations, and it briefly stages the lock); `git add -f` (does the opposite of what is wanted).

- **Failure of the detection command**: any status other than "ignored" answers false, keeping the
  exclusion. **Rationale**: that is the pre-change behaviour, so a broken or ancient git degrades to
  today's semantics and can never cause the lock to be committed. **Alternatives considered**: failing the
  rescue on an unreadable ignore state (turns a diagnostic into an outage).

- **Ordering inside the rescue**: stage first, create the recovery branch only after staging succeeds.
  **Rationale**: the index is branch-independent and `git checkout -b` at the same commit carries it, so
  the reorder is free and removes the "the log named a branch that does not exist" symptom at its source.
  **Alternatives considered**: deleting the branch on a staging failure (a `git branch -D` on the error
  path is the worst possible place for one); leaving the order and relying on prune protection alone
  (leaves an empty branch behind after every failed rescue).

- **Protecting the rescue branch from the same tick's prune**: the branch the rescue created — or, in a dry
  run, would create — is added to the prune phase's untouchable set for that tick. **Rationale**: the
  existing prune rules ("delete only on positive evidence the branch is finished") are correct and must not
  be weakened; the only branch at risk is the one this tick just made, which by construction has no remote
  yet. A successfully rescued branch has been pushed and so was never a candidate, which is why the rule can
  be stated unconditionally. **Alternatives considered**: never deleting a branch whose name starts with
  `rescue/` (would make merged rescue branches immortal); running prune before rescue (breaks the
  documented ordering that keeps a just-pushed branch out of the candidate set).

- **Reporting shape for pre-flight failures**: add `describePreflightFailures(report)` and append its
  causes to the existing per-item skip line and detail. **Rationale**: the rescue and base failures are
  already modelled separately as `RescueOutcome` and `BaseOutcome`; only the carry to the place the
  operator reads the consequence was missing. Appending keeps `PrepareFailureReason` a closed union, which
  the JSON output and the operation log consume. **Alternatives considered**: a new `preflight-failed`
  per-item reason (a breaking change to a consumed union, for a reporting fix); printing the causes once
  after the work plan (the reported run shows operators read the per-item lines).

- **Diverged base branch**: behaviour unchanged — `pull --ff-only` still refuses — and the operator
  recovery is documented instead. **Rationale**: the module's hard rule is that nothing unattended may
  discard work, and deciding whether a local-only commit on the base branch is wanted is a human judgement.
  **Alternatives considered**: auto-resetting the base branch to `origin` when the local commits look like
  automata's own — rejected because the safety proof that exists for force-pushed pull-request branches
  (`resetToForcePushedRemote`) has no equivalent here, and the blast radius is the whole repository.

- **Project structure**: no new module; each change lands in the module that already owns the concern —
  git argv in `src/git/gitService.ts`, sequencing and decisions in `src/git/repoHygiene.ts`, reporting in
  `src/commands/doWork.ts`. **Rationale**: Constitution Principle III, and it keeps the diff reviewable
  against the reported defect. **Alternatives considered**: a dedicated "pre-flight diagnostics" module
  (an abstraction with one caller, which Principle V rules out).
