# Feature Specification: `do-work` pre-flight repository hygiene

**Feature Branch**: `feature/032-do-work-repo-hygiene`

**Created**: 2026-09-10

**Status**: Draft

**Input**: User description: "032-do-work-repo-hygiene: do-work pre-flight repository hygiene — rescue uncommitted changes into a branch/PR instead of refusing, always checkout+pull the base branch once per tick, and prune local branches with no remote whose PR is absent or not open (rescuing any commits not already in develop first). Closes #47"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Uncommitted work is rescued, not refused (Priority: P1)

An operator (or a previous interrupted tick) leaves modified and untracked files in the
checkout. Today every work item of the next tick is skipped with `dirty-tree`, so the loop
stalls silently until a human notices and cleans up by hand — and the uncommitted work has
no backup anywhere.

With this feature, the tick opens by putting that work somewhere safe: it is committed to a
branch, pushed, and a draft pull request is opened for it. Only then does the tick continue,
now on a clean tree, and the items that used to be skipped run normally.

**Why this priority**: It is the change that unblocks the loop. Without it a dirty tree is a
hard stop for every item in every tick, and the work at risk of being lost is the reason the
stop exists in the first place.

**Independent Test**: Leave an uncommitted file in a checkout, run one tick, and confirm the
tree is clean afterwards, that a branch carrying the change exists on the remote, that a
draft pull request points at it, and that the tick's items no longer report `dirty-tree`.

**Acceptance Scenarios**:

1. **Given** the tree is dirty and HEAD is the base branch, **When** a tick starts, **Then** a
   `rescue/<base>-<UTC timestamp>` branch is created off HEAD, every change (tracked and
   untracked) is committed to it, it is pushed, and a draft pull request against the base
   branch is opened for it.
2. **Given** the tree is dirty and HEAD is a branch other than the base branch, **When** a tick
   starts, **Then** the changes are committed onto that branch and pushed, and a draft pull
   request is opened only if that branch does not already have an open one.
3. **Given** the tree is dirty, **When** the rescue runs, **Then** automata's own run-lock file is
   excluded from the commit and does not by itself make the tree look dirty.
4. **Given** the tree is clean, **When** a tick starts, **Then** no branch, commit, push or pull
   request is created.
5. **Given** the tree is dirty and the rescue fails (push rejected, `gh` unavailable), **When** a
   tick starts, **Then** nothing is discarded, the failure is reported, and the tick continues
   with the pre-existing `dirty-tree` behaviour rather than erroring out.

---

### User Story 2 - The base branch is always up to date (Priority: P2)

The tick's decisions are made against the base branch, and any work it starts branches off
it. Today the base branch is only checked out and pulled once an actionable item has been
found, so a tick with nothing to do leaves the checkout on whatever branch the last tick
finished on, at whatever commit it had.

**Why this priority**: It is the smallest of the three changes and it makes the checkout's
state predictable between ticks, which is what the other two steps rely on.

**Independent Test**: Run a tick in a checkout sitting on a stale feature branch with no
actionable issues, and confirm the checkout ends on the base branch at the remote's tip.

**Acceptance Scenarios**:

1. **Given** a checkout on a stale branch and no actionable issues, **When** a tick runs, **Then**
   the base branch is checked out and fast-forwarded to the remote before the tick reports
   "nothing to do".
2. **Given** the base branch has diverged from its remote, **When** the pre-flight pulls, **Then**
   the fast-forward-only pull fails loudly and is reported rather than being merged.

---

### User Story 3 - Dead local branches are pruned (Priority: P3)

Every tick that picks up an issue leaves a local branch behind. Over weeks the checkout
accumulates branches whose pull request was merged and whose remote branch is long gone, plus
branches from runs that never opened a pull request at all.

**Why this priority**: It is maintenance. Nothing is blocked by the clutter, so it ships after
the two behaviours that change whether a tick can work at all.

**Independent Test**: Create a local branch that exists on no remote and has no pull request,
run a tick, and confirm the branch is gone — and that a second such branch carrying commits
absent from the base branch is pushed with a draft pull request instead of being deleted.

**Acceptance Scenarios**:

1. **Given** a local branch that does not exist on `origin` and has no pull request at all, and
   whose commits are all reachable from the base branch, **When** a tick runs, **Then** the branch
   is deleted.
2. **Given** a local branch that does not exist on `origin` with a `MERGED` pull request, **When**
   a tick runs, **Then** the branch is deleted regardless of how many of its commits are
   unreachable from the base branch — a squash merge lands the change without the commits.
2b. **Given** a local branch that does not exist on `origin` whose only pull request is `CLOSED`
   without merging, **When** a tick runs, **Then** it is treated as having no pull request: deleted
   only if its commits are all reachable from the base branch.
3. **Given** a local branch that does not exist on `origin` and has an `OPEN` pull request,
   **When** a tick runs, **Then** the branch is kept.
4. **Given** a local branch that does not exist on `origin`, has no open pull request, but
   carries commits not reachable from the base branch, **When** a tick runs, **Then** the branch is
   pushed, a draft pull request is opened for it, and the branch is **not** deleted.
5. **Given** the base branch, the branch currently checked out, or any configured protected
   branch, **When** the prune runs, **Then** they are never candidates for deletion.
6. **Given** a local branch that does exist on `origin`, **When** the prune runs, **Then** it is not
   a candidate, regardless of its pull request state.
7. **Given** the pull-request lookup for a candidate fails, **When** the prune runs, **Then** the
   branch is kept and the failure is reported — uncertainty never deletes.

---

### User Story 4 - The whole pre-flight is inspectable (Priority: P3)

An operator wants to see what the hygiene step would do to their checkout before letting it
run unattended.

**Why this priority**: `--dry-run` is already the documented way to inspect a tick; a
destructive new step that ignored it would be the one part of `do-work` an operator could not
preview.

**Independent Test**: Run `automata do-work --dry-run` in a checkout with a dirty tree and a
dead local branch, and confirm the output names both the rescue and the deletion and that
neither happened.

**Acceptance Scenarios**:

1. **Given** `--dry-run`, **When** the pre-flight runs, **Then** it reports what it would rescue,
   pull and prune, and performs no commit, push, pull, pull-request creation or branch
   deletion.
2. **Given** `--json`, **When** the tick completes, **Then** the pre-flight outcome appears as
   structured data alongside the existing plan and item reports.

---

### Edge Cases

- **Detached HEAD with a dirty tree**: treated like the base-branch case — a `rescue/*` branch
  is created off the detached commit.
- **Dirty tree consisting only of the run-lock file**: not dirty; the existing lock-path
  exclusion is reused so the rescue does not fire on automata's own artefact.
- **The rescue label does not exist in the repository**: pull-request creation is retried
  without the label rather than failing.
- **A rescue branch name already exists**: the timestamp is second-resolution UTC and the
  branch name includes the source branch, so a collision means a second tick started in the
  same second; the create fails, the failure is reported, and nothing is discarded.
- **`origin` cannot be reached**: the remote-branch listing fails, so no branch can be proven
  remote-less and the prune step does nothing.
- **A branch whose commits are all in the base branch but which has an open pull request**:
  kept — the open pull request wins over reachability.
- **A squash-merged branch**: its own commits are never in the base branch, so the reachability
  count is highest for exactly the branches that are safest to delete. The `MERGED` pull request
  is checked first, and the count is not consulted at all.
- **A branch with both a `CLOSED` and a `MERGED` pull request**: the merge wins; the branch is
  deleted.
- **Zero actionable issues**: the pre-flight still runs in full; it is not gated on there
  being work.
- **`--issue <n>` restricting the tick**: the pre-flight is not per-item, so it runs unchanged.

## Clarifications

### Session 2026-09-10 (autonomous)

- Q: Does the rescue commit untracked files as well as modified ones? → A: Yes — everything
  except automata's run-lock path. [AUTO: the dirtiness test already ignores only the lock, so
  anything else it counts as dirty must end up in the commit or the tree stays dirty and the
  rescue achieves nothing.]
- Q: Does the pre-flight run before or after the run lock is taken? → A: After. [AUTO: it
  commits, pushes, checks out and deletes branches, so two concurrent ticks doing it would
  race on the same checkout; the lock exists for exactly that. It therefore also does not run
  when the lock is held, which is the existing "do nothing" path.]
- Q: What identifies a rescue commit? → A: `chore(automata): rescue uncommitted work from
  <source branch>`, and a pull-request body naming `automata do-work`'s hygiene step. [AUTO:
  matches the repo's conventional-commit style and makes the provenance obvious in `git log`
  without needing the pull request.]
- Q: Does the pre-flight report its own exit code, or fold into the tick's? → A: It folds into
  the tick's: a degraded pre-flight forces exit 2 and is listed in the summary. [AUTO: adding a
  third exit code would change a documented contract that cron consumers rely on; exit 2
  already means "the tick ran but something was not clean".]
- Q: Where does prune sit relative to work detection? → A: Before it, immediately after the
  base-branch pull. [AUTO: pruning after the items ran would delete a branch a run had just
  created, and running it before the rescue would delete a branch whose commits the rescue was
  about to push.]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `do-work` MUST run a repository-hygiene pre-flight once per tick, before issue
  discovery, in the order: rescue uncommitted changes → check out and pull the base branch →
  prune dead local branches.
- **FR-002**: When the working tree has uncommitted changes (ignoring automata's run-lock
  path), the pre-flight MUST commit them — tracked, staged and untracked alike — push them,
  and ensure an open pull request exists for the resulting branch, rather than leaving the
  tree dirty for every item to skip on.
- **FR-003**: The rescue MUST commit onto the branch already checked out when that branch is
  not the base branch, and MUST create a new `rescue/<source>-<UTC timestamp>` branch off HEAD
  when HEAD is the base branch or detached. It MUST NOT commit to or push the base branch.
- **FR-004**: The rescue MUST NOT open a second pull request for a branch that already has an
  open one.
- **FR-005**: The pre-flight MUST check out the base branch and fast-forward it to the remote
  on every tick, including a tick with no actionable issues.
- **FR-006**: A pull that cannot fast-forward MUST be reported as a pre-flight failure and
  MUST NOT be resolved by a merge, rebase, reset or stash.
- **FR-007**: The prune step MUST consider only local branches whose name does not exist on
  `origin`, and MUST never consider the base branch, the branch currently checked out, or a
  configured protected branch.
- **FR-008**: For each candidate the prune step MUST look up that branch's pull requests in
  any state, and MUST keep the branch when one of them is open.
- **FR-009**: A candidate with a `MERGED` pull request MUST be deleted, whatever its commit
  reachability — the merge is authoritative proof the work landed, and a squash merge puts the
  change in the base branch without any of the branch's commits.
- **FR-009a**: A candidate with no pull request, or only ones closed without merging, MUST be
  deleted only when it carries no commit that is unreachable from the base branch; otherwise it
  MUST be pushed, given a draft pull request, and kept.
- **FR-010**: Any failure inside the pre-flight (rescue, pull, pull-request lookup, deletion)
  MUST be reported and MUST NOT delete a branch, discard changes or abort the tick; the tick
  continues with its existing behaviour.
- **FR-011**: Every pull request the pre-flight opens MUST be a draft against the base branch,
  MUST carry a body identifying it as created by `automata do-work`'s hygiene step, MUST NOT
  reference an issue, and MUST NOT request reviewers.
- **FR-012**: `--dry-run` MUST report the full pre-flight plan and perform none of it.
- **FR-013**: The pre-flight outcome MUST appear in the human summary and, under `--json`, as
  structured data.
- **FR-014**: A degraded pre-flight MUST make the tick exit 2 when it would otherwise exit 0,
  and MUST NOT change exit 1's meaning ("a precondition failed, nothing was attempted").

### Key Entities

- **Rescue outcome**: what happened to uncommitted work — nothing to do, or the branch it was
  committed to, whether it was pushed, and the pull request it landed under (existing or new).
- **Prune candidate**: a local branch name, whether it exists on `origin`, whether any of its
  pull requests is open or merged, and the count of its commits unreachable from the base branch
  (consulted only when no pull request merged).
- **Prune outcome**: per candidate — deleted, kept (open pull request), rescued (pushed with a
  new draft pull request), or kept because a lookup failed.
- **Pre-flight report**: the rescue outcome, the base-branch preparation result, and the list
  of prune outcomes, plus whether any of them degraded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A tick starting with a dirty tree completes with a clean tree and zero items
  skipped for `dirty-tree`, where today every item is skipped.
- **SC-002**: No commit reachable only from a deleted branch is lost: for every branch the
  pre-flight deletes, all of its commits are reachable from the base branch at deletion time.
- **SC-003**: After any tick, the checkout is on the base branch at the remote's tip, whether
  or not the tick had work to do.
- **SC-004**: Across repeated ticks the count of local branches that exist on no remote and
  have no open pull request trends to zero without operator intervention.
- **SC-005**: `--dry-run` produces no new commit, branch, push, pull request or deletion,
  verified by an unchanged `git` state afterwards.

## Assumptions

- [AUTO] **A `MERGED` pull request outranks the commit count** (decided during implementation,
  after a dry run against this repository showed `feature/update-spec-kit` — squash-merged as
  PR #33 — being queued for a *rescue*, because none of its three commits are in `develop`).
  Rationale: a squash merge lands the change without the commits, so reachability is the wrong
  question for the branches that are safest to delete; GitHub reporting the pull request merged
  is stronger and cheaper evidence than grepping `git log` for a squash-commit message, which is
  what the repository's `branches` skill does today.
- [AUTO] **A branch with unmerged commits is rescued, not force-deleted**: the issue asks for
  `git branch -D`, which discards commits. Chosen behaviour is to delete only when every
  commit is already reachable from the base branch, and to push + open a draft pull request
  otherwise. Rationale: `do-work` documents "never stash, reset or discard uncommitted work it
  did not create", and the issue's own stated goal is "so the user can avoid losing work";
  unconditional `-D` would contradict both. This was raised on the issue and answered "sounds
  ok proceed".
- [AUTO] **Rescue commits onto the current branch whenever it is not the base branch**, and
  creates a `rescue/*` branch only from the base branch or a detached HEAD. Rationale: it
  keeps the work on the branch it belongs to instead of spawning a parallel branch, and it
  makes the step idempotent — the next tick sees a branch with a remote and an open pull
  request and leaves it alone. This narrows the earlier "always create `rescue/<base>-<ts>`"
  sketch to the case where there is no better branch to use.
- [AUTO] **Pull requests opened by the pre-flight are drafts labelled `rescue`**, with the
  label applied best-effort. Rationale: draft keeps them out of review queues, and the label
  makes them filterable. They need no exclusion from work detection: detection is issue-driven
  through closing references, and a rescue pull request has none, so it can never be picked up
  as an issue's pull request.
- [AUTO] **No new configuration key and no new CLI flag**: the behaviour is unconditional, as
  the issue requests, and is inspectable through the existing `--dry-run`. Rationale: the
  project constitution's simplicity principle, and every new key in this repo must be
  reachable both from `automata config set` and from the wizard — cost not justified by a
  behaviour the owner asked for unconditionally.
- [AUTO] **Per-item branch preparation is left unchanged**: the pre-flight adds a once-per-tick
  checkout and pull, it does not replace `prepareBaseBranch` / `preparePrBranch`. Rationale:
  those calls are also the per-item dirty-tree guard, and a second fast-forward pull on an
  already-current branch is one cheap call — removing them would trade a real safety guard for
  it.
- [AUTO] **Candidacy is decided by whether the branch name exists on `origin`**, resolved with
  a single remote listing rather than a per-branch query. Rationale: one network call instead
  of N, and it answers the issue's "has no remote" directly, independently of whether an
  upstream was ever configured locally.
- [AUTO] **A failed pre-flight degrades the tick rather than failing it**: exit 2, not exit 1.
  Rationale: exit 1 is documented as "nothing was attempted", which would be false, and the
  pre-existing `dirty-tree` skip path still protects the work.
- The repository's remote is GitHub and `gh` is installed and authenticated — the same
  assumption the rest of `do-work` already makes. An `azdo` remote is out of scope, as it is
  for `do-work` as a whole.
- The base branch always exists locally, which `do-work` already assumes when it checks it out
  per item.
