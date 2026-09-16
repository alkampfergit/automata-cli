# Feature Specification: Explicit branch-synchronisation strategy for `do-work`

**Feature Branch**: `feature/036-explicit-rebase-sync`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "`automata do-work` can become permanently unable to process a pull request when the local
checkout and its remote branch have diverged, even when both tips contain the same files and the same patch. The
current implementation hard-codes `git pull --ff-only`, so configuring Git's pull strategy does not help the unattended
loop. Please make branch synchronization recoverable without discarding agent work. […] It can be implemented, also
update all the references from npm so we can publish a new release." (GitHub issue #73)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An equivalent divergence stops blocking the loop (Priority: P1)

As the operator of an unattended `do-work` loop, when a pull-request branch in my checkout has diverged from its remote
but every local-only commit is already present upstream as the same patch, I want the tick to synchronise the branch by
itself and answer the item, so that the pull request stops being skipped on every tick until I intervene by hand.

**Why this priority**: This is the reported defect. Without it a single equivalent divergence takes one pull request out
of the loop permanently, and the operator has no signal beyond a repeated skip.

**Independent Test**: Create a checkout whose local branch tip and `origin/<branch>` tip are different commits with the
same parent and the same tree, and confirm `do-work` synchronises the branch instead of skipping it as `pull-failed`.

**Acceptance Scenarios**:

1. **Given** a pull-request branch whose local-only commits are all patch-equivalent to commits already on
   `origin/<branch>`, **When** the fast-forward pull fails, **Then** the branch is rebased onto `origin/<branch>` and the
   turn proceeds.
2. **Given** the same branch, **When** the tick finishes, **Then** the operator can see that the branch was synchronised
   by a rebase rather than by a fast-forward.
3. **Given** a pull-request branch that is simply behind its remote, **When** the tick prepares it, **Then** the plain
   fast-forward still handles it and no rebase is attempted.

### User Story 2 - Unpushed agent work is never dropped (Priority: P1)

As the maintainer of the repository, when a local pull-request branch carries a commit an agent made and never pushed, I
want `do-work` to refuse the item and tell me exactly what it found, so that the automation never rewrites or discards
work that exists only in that checkout.

**Why this priority**: Equal to P1 with User Story 1 — the recovery is only acceptable if it is provably non-destructive.
A recovery that can silently lose a commit is worse than the stuck loop it replaces.

**Independent Test**: Give the local branch one genuinely new commit plus a diverged remote, and confirm the item is
refused with a message naming the commits to inspect, with the local branch left untouched.

**Acceptance Scenarios**:

1. **Given** a local-only commit that is not represented upstream, **When** the fast-forward fails, **Then** no rebase
   and no reset is attempted and the item is skipped with an actionable message.
2. **Given** such a refusal, **When** the operator inspects the branch afterwards, **Then** the local tip is exactly
   where it was before the tick.
3. **Given** a local-only *merge* commit, **When** the fast-forward fails, **Then** the branch is refused rather than
   rebased, because patch equivalence cannot be established for a merge.

### User Story 3 - A conflicting rebase is a distinct, non-repeating failure (Priority: P2)

As the operator, when the automatic rebase cannot be completed because it conflicts, I want the checkout left in a clean
state and the item reported under its own failure reason, so that I can tell a conflict apart from an ordinary
divergence refusal in the logs.

**Why this priority**: Recoverable-looking failures that all report the same reason are what made the original defect
invisible. It is not P1 because it only affects diagnosis, not data safety.

**Independent Test**: Force a rebase to conflict and confirm the rebase is aborted, the branch is back at its original
tip, and the item is reported with a `rebase-conflict` reason.

**Acceptance Scenarios**:

1. **Given** a rebase that conflicts, **When** it fails, **Then** the rebase is aborted so no `.git/rebase-merge` state
   is left behind.
2. **Given** the abort, **When** the item is reported, **Then** the reason is `rebase-conflict` and not `pull-failed`.

### User Story 4 - The operation log names the strategy (Priority: P3)

As the operator of a cron-driven loop that discards stdout, I want the operation log to record which synchronisation
strategy each item used and any refusal or conflict, so that I can diagnose a stuck branch after the fact.

**Why this priority**: Diagnostic only, and the operation log is best-effort by design.

**Independent Test**: Run a tick in which one item rebases and one is refused, and confirm both are visible in the
operation log.

**Acceptance Scenarios**:

1. **Given** an item synchronised by a rebase or a reset, **When** the work record is written, **Then** the line names
   that strategy.
2. **Given** a tick with any non-trivial synchronisation, **When** the execution line is written, **Then** it carries a
   `sync=` field counting each strategy and refusal.
3. **Given** a tick where every item fast-forwarded, **When** the execution line is written, **Then** no `sync=` field
   is added.

### User Story 5 - The release ships current dependencies (Priority: P2)

As the maintainer preparing a release, I want every npm reference refreshed to the current version and the audit clean,
so that the published package and its development toolchain are up to date.

**Why this priority**: Explicitly asked for in the same instruction, and independently deliverable from the git
behaviour.

**Independent Test**: `npm outdated` reports nothing that this project can act on, and `npm run audit:prod` and
`npm run audit:all` both report zero vulnerabilities.

**Acceptance Scenarios**:

1. **Given** the refreshed `package.json` and lockfile, **When** `npm ci` runs from a clean tree, **Then**
   `npm test && npm run lint` passes.
2. **Given** the refreshed tree, **When** `npm audit` runs, **Then** it reports zero vulnerabilities.

### Edge Cases

- The local branch has no previously known remote-tracking ref (first sight of the branch) and the fast-forward fails —
  refused, as today.
- The branch has no local-only commits at all yet the fast-forward still fails — refused; the cause is not a divergence
  this feature understands.
- The worktree is dirty — refused before any git command that could move a ref, exactly as today.
- `git cherry` cannot be run (a broken ref, a corrupt object store) — treated as "cannot establish safety" and refused.
- The base branch diverges — still fast-forward-only, still a situation for a human.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every pull and rebase `do-work` performs MUST name its strategy on the command line, so no behaviour
  depends on the ambient `pull.rebase` / `pull.ff` git configuration of the machine running the loop.
- **FR-002**: When preparing a pull-request branch, the system MUST first attempt a fast-forward-only pull.
- **FR-003**: When that fails, the system MUST keep the existing force-push recovery: reset to the remote when the local
  tip was already reachable from the remote-tracking ref as this checkout last saw it.
- **FR-004**: When neither applies, the system MUST classify the local-only commits against the remote-tracking ref and
  rebase the branch onto that ref **only** when there is at least one local-only commit, none of them is a merge commit,
  and every one of them is already present upstream as an equivalent patch.
- **FR-005**: When any local-only commit is not represented upstream, the system MUST refuse the item without moving any
  ref, and the message MUST name the branch, how many commits are unpushed, and the command to inspect them.
- **FR-006**: When the rebase fails, the system MUST abort it so the checkout is left on the original tip with no rebase
  in progress, and MUST report the item under a `rebase-conflict` reason distinct from `pull-failed`.
- **FR-007**: The base branch MUST continue to be synchronised fast-forward-only; this feature MUST NOT introduce a
  rebase, merge or reset of the base branch.
- **FR-008**: A successful preparation MUST report which strategy was used, and `do-work` MUST print it on the item's
  progress line.
- **FR-009**: The operation log MUST carry the per-item strategy on the work record and a per-tick `sync=` summary on
  the execution line covering both non-trivial strategies and synchronisation refusals; it MUST stay best-effort and
  MUST NOT change the command's stdout, exit code or outcome.
- **FR-010**: Any other pull this CLI performs on a user's behalf MUST also name its strategy explicitly rather than
  relying on git configuration.
- **FR-011**: Every npm dependency reference MUST be refreshed to the current release the project can adopt, the
  lockfile regenerated, and both audit scripts MUST report zero vulnerabilities.
- **FR-012**: The user-visible behaviour changes MUST be documented in `docs/do-work.md`, `docs/git.md`,
  `docs/wiki/Troubleshooting.md` and `CHANGELOG.md` under `Unreleased`.

### Key Entities

- **Synchronisation strategy**: how a branch was brought up to the remote — `fast-forward`, `tracking-branch`
  (the branch was created locally from the remote), `reset-to-remote` (force-push recovery) or `rebase`.
- **Divergence report**: the commits present on the local branch and not on the remote-tracking ref, each marked as
  already-upstream-by-patch or not, plus a count of merge commits among them.
- **Prepare failure reason**: `dirty-tree`, `checkout-failed`, `pull-failed` and the new `rebase-conflict`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A pull-request branch whose divergence consists only of already-applied commits is processed on the next
  tick, with zero manual git commands.
- **SC-002**: In every refusal path, the local branch tip after the tick is byte-identical to the tip before it.
- **SC-003**: The four preparation outcomes (`fast-forward`, `reset-to-remote`, `rebase`, refusal) and the conflict path
  are each covered by a test, and the divergence classification is covered by a test that runs real `git`.
- **SC-004**: `npm test && npm run lint` passes and `npm audit` reports zero vulnerabilities on the refreshed tree.

## Assumptions

- [AUTO] Ordering of recovery attempts: fast-forward, then force-push reset, then rebase. Chosen because the first two
  already exist and are cheaper and more conservative than a rebase, so the new path only runs where today's code
  refuses.
- [AUTO] Rebase mechanics: `git rebase refs/remotes/origin/<branch>` against the already-fetched remote-tracking ref,
  rather than `git pull --rebase`. Chosen because `preparePrBranch` has already fetched that ref, a second network round
  trip is waste, and a bare `rebase <ref>` cannot be re-interpreted by a machine's `pull.*` configuration — which is the
  root cause in the issue.
- [AUTO] Safety predicate: `git cherry <upstream> <head>` (patch-id equivalence), guarded by a merge-commit count.
  Chosen because `git cherry` is git's own answer to "is this commit already applied upstream", and it is exactly the
  relationship the issue describes; the merge guard exists because `git cherry` silently omits merge commits, which
  would otherwise read as "nothing unpushed".
- [AUTO] Genuine unpushed commits are refused, not rebased. Chosen because rebasing them would rewrite commits that
  would then need a force push to land, which is outside the safety envelope `do-work` documents.
- [AUTO] The base branch keeps `--ff-only`. Chosen because the issue asks for base-branch synchronisation to stay safe
  and the existing documented contract says a diverged base branch is a situation for a human.
- [AUTO] `checkoutAndPull` (used by `automata git finish-feature`) becomes `git pull --ff-only`. Chosen because FR-001
  is about the whole CLI, and a bare `git pull` there is the exact command that produced the reported
  `fatal: Need to specify how to reconcile divergent branches`.
- [AUTO] Operation-log shape: an optional per-item `sync` field plus an optional aggregate `sync=` field on the
  execution line. Chosen over adding refused items to the work record, because work-record membership is defined as
  "the executor ran" and `--max-runs` is derived from the same predicate.
- [AUTO] Dependency refresh scope: every direct dependency moves to the newest version the project can adopt while
  `npm test && npm run lint` stays green. A major that breaks the gate is reverted and recorded as a deferral rather
  than shipped broken.
- [AUTO] `package.json`'s `version` field stays `0.1.0`. Chosen because `docs/maintenance.md` states CI rewrites it from
  the git tag at publish time; the release-facing deliverable here is the `CHANGELOG.md` `Unreleased` section.

## Clarifications

- Q: Should a genuinely unpushed local commit be rebased onto the remote instead of refused? → A: No — refuse.
  [AUTO: the issue says "must not silently drop them; report the conflict and preserve the work", and a rebase of
  unpushed commits forces a later force-push, which `do-work`'s documented safety rules do not permit.]
- Q: Should the pull strategy be a config key? → A: No — a fixed, explicit sequence.
  [AUTO: the issue's requirement is determinism in unattended execution; a config key reintroduces "it depends on this
  machine", which is the failure being fixed. Scope stays minimal.]
- Q: Should the base branch also gain the rebase path? → A: No.
  [AUTO: FR-007; the issue explicitly asks base-branch synchronisation to remain safe and unchanged.]
- Q: Does "update all the references from npm" mean cutting a release too? → A: No — refresh dependencies and populate
  `CHANGELOG.md`'s `Unreleased`; the tag and publish are the maintainer's step.
  [AUTO: `docs/maintenance.md` documents the release as a manual `automata git publish-release` run on a clean tree.]
- Q: Where should the strategy be surfaced for a successful item? → A: On the item's progress line (stderr) and in the
  operation log. [AUTO: matches the existing split documented in `docs/do-work.md` — per-item detail on stderr, the
  summary on stdout.]
