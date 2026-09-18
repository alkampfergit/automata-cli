# Spec Decisions: Explicit branch-synchronisation strategy for `do-work`

**Branch**: `feature/036-explicit-rebase-sync`
**Date**: 2026-09-16
**Spec**: [specs/036-explicit-rebase-sync/spec.md](spec.md)
**Plan**: [specs/036-explicit-rebase-sync/plan.md](plan.md)
**Research**: [specs/036-explicit-rebase-sync/research.md](research.md)

## Planning Decisions

- **Safety predicate**: classify the local-only commits with `git cherry <upstream> <head>` and rebase only when the
  range is non-empty, holds no merge commit, and every commit is reported as already upstream. **Rationale**: `git
  cherry` is git's own patch-id answer to "is this already applied upstream", which is exactly the relationship issue
  #73 describes; the merge guard exists because `git cherry` was measured to omit merge commits silently, so without it
  unpushed content behind a local merge would read as "nothing to lose". **Alternatives considered**: `merge-base
  --is-ancestor` (already present as the force-push path and blind to this case); comparing end trees (true in the
  reported example, but a coincidence of that example rather than a property of the class); hand-rolling `git patch-id`
  over `rev-list` (reimplements `git cherry`).

- **Rebase mechanics**: `git rebase refs/remotes/origin/<branch>` against the ref `preparePrBranch` has already fetched.
  **Rationale**: determinism — `git pull --rebase` still consults the machine's `pull.*` / `rebase.*` configuration, and
  configuration-dependence is the root cause in the issue; and cost — the ref is already local, so a pull would be a
  second network round trip. **Alternatives considered**: setting `pull.rebase=true` and pulling (the issue's manual
  workaround — rejected because writing an operator's git configuration is a side effect outside the checkout);
  `git pull --rebase origin <branch>` (redundant fetch, still configuration-sensitive); `git reset --hard origin/<branch>`
  (same result in the safe case, but destructive if the classification is ever wrong, whereas a rebase replays and stops).

- **Genuinely unpushed commits are refused, not rebased**. **Rationale**: a rebase would preserve them but rewrite them,
  and the rewritten branch could only reach the remote through a force push, which is outside the safety envelope
  `docs/do-work.md` documents. The issue asks for such work to be preserved and reported, which a refusal does — so the
  refusal message was upgraded to name the count and the inspection command instead. **Alternatives considered**: rebase
  and force-push (rejected: it would make `do-work` capable of rewriting a human's branch).

- **A conflicting rebase is aborted and reported as `rebase-conflict`**. **Rationale**: `git rebase` was measured to
  exit `1` and leave a detached HEAD with a conflicted index, which the next tick's `hasUncommittedChanges` check would
  read as a dirty tree — turning one item's conflict into a repository-wide `dirty-tree` for every item, the same "stuck
  forever" shape the feature removes. `git rebase --abort` restores the exact pre-rebase sha. The distinct reason
  answers the issue's "a distinct actionable failure instead of repeating the same skip forever".
  **Alternatives considered**: leaving the conflict in place (cascade above); reusing `pull-failed` (it is why the
  original defect was invisible in the logs).

- **Order of recovery**: fast-forward, then the existing force-push reset, then the new rebase. **Rationale**: the first
  two are cheaper and rest on reachability rather than patch equivalence, and putting the new path last means it only
  runs where the current code already refuses — so nothing that works today can regress.
  **Alternatives considered**: rebasing uniformly (replaces two proven paths with one unproven one for no gain).

- **The base branch stays fast-forward-only**, in both `prepareBaseBranch` and the hygiene pre-flight's `prepareBase`.
  **Rationale**: the issue asks for base-branch synchronisation to remain safe and untouched, and the documented
  contract is that a diverged base branch is a situation for a human. **Alternatives considered**: extending the rebase
  path to the base branch (rejected as explicitly out of scope).

- **`checkoutAndPull`'s bare `git pull` becomes `git pull --ff-only`**. **Rationale**: `fatal: Need to specify how to
  reconcile divergent branches` — the first error quoted in the issue — is precisely what a bare `git pull` produces
  where no strategy is configured, and that was the last bare pull left in the CLI. **Alternatives considered**: leaving
  it (rejected: same defect class, second location, and FR-001/FR-010 cover the whole CLI).

- **Operation-log shape**: an optional `TickLogItem.sync` rendered on the work-record line, plus an aggregate
  `sync=<strategy>:<n>,…` field on the execution line covering non-trivial strategies and refusals.
  **Rationale**: work-record membership is defined as "the executor ran" so it can never disagree with `--max-runs`,
  which means a refused item cannot appear there; the execution line is the per-tick aggregate and is where refusal
  counts belong. The field is omitted entirely when nothing interesting happened, so existing greps see an unchanged
  line. **Alternatives considered**: adding refused items to the work record (breaks the `--max-runs` equivalence);
  folding the strategy into `detail` (free text, truncated at 200 characters, not greppable as a field).

- **Dependency refresh stops short of TypeScript 7**. **Rationale**: constitution principle II fixes the stack at
  "TypeScript 5.x (strict mode)", so adopting the native-port compiler is a stack change needing its own amendment and
  risk assessment; `npm audit` is already clean, so this refresh is currency, not remediation.
  **Alternatives considered**: taking TypeScript 7 and reverting if the gate failed (rejected: a green gate would still
  be an undeclared stack change); skipping the refresh (explicitly asked for).

- **Project structure**: no new module or directory. **Rationale**: every change lands in the module that already owns
  the concern — git invocations in `gitService`, sequencing and safety in `workspaceService`, reporting in `doWork` and
  `operationLog` — because the feature is a new branch in an existing decision tree plus one new git primitive.
  **Alternatives considered**: a dedicated `branchSync` module (rejected under constitution principle V: it would be an
  indirection layer around three functions).
