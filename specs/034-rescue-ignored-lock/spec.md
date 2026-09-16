# Feature Specification: Rescue survives an ignored run lock, and pre-flight failures are reported separately

**Feature Branch**: `feature/034-rescue-ignored-lock`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "Fix do-work rescue failing on ignored automata.lock and report base pull failures separately (issue #69)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The rescue works in a repository that gitignores the run lock (Priority: P1)

An operator runs `automata do-work` in a checkout that has a dirty working tree and has added
`.automata/automata.lock` to its `.gitignore`. The pre-flight rescue commits the dirty work onto a
recovery branch, pushes it and opens a draft pull request, exactly as it does in a checkout that does
not ignore the lock. The tick then goes on to answer the discovered work instead of skipping every
item as `dirty-tree`.

**Why this priority**: this is the reported defect. While it stands, every tick in an affected
checkout does no work at all, and the failure is silent enough to look like "there was nothing to do".

**Independent Test**: run a tick with a modified tracked file, an untracked file and an ignored
`.automata/automata.lock`; assert the rescue reaches the commit/push/PR steps and reports `rescued`.

**Acceptance Scenarios**:

1. **Given** a dirty tree and a `.automata/automata.lock` that `.gitignore` matches, **When** the
   pre-flight rescue stages the changes, **Then** staging succeeds and the tracked modification and
   the untracked file are both committed to the recovery branch.
2. **Given** the same tree, **When** the rescue completes, **Then** the run lock is *not* part of the
   rescue commit.
3. **Given** a checkout that does *not* ignore the run lock, **When** the rescue stages the changes,
   **Then** the lock is still excluded, so behaviour in that checkout is unchanged.

---

### User Story 2 - A failed rescue leaves no phantom recovery branch, and never loses one that holds work (Priority: P2)

When the rescue cannot stage or commit, the operator must not be told a recovery branch was created
and then find it gone. Either the branch was never created, or it still exists after the tick.

**Why this priority**: the reported run created `rescue/develop-…`, failed to stage, and the prune
phase then deleted the empty branch — so the log named a branch the operator could not find. It
compounds the P1 defect by making it hard to diagnose.

**Independent Test**: force the staging step to fail and assert no recovery branch was created; force
the push step to fail and assert the branch still exists after the prune phase.

**Acceptance Scenarios**:

1. **Given** a dirty tree, **When** staging fails, **Then** no recovery branch was created and the
   failure names the staging step.
2. **Given** a rescue that committed but could not push, **When** the prune phase runs in the same
   tick, **Then** the recovery branch is not a deletion candidate.

---

### User Story 3 - Per-item skips name the pre-flight failure that caused them (Priority: P2)

An operator reading a tick's output can tell *why* the items were skipped: a rescue that failed, a
base branch that could not be fast-forwarded, or both. The two causes are reported separately rather
than collapsed into one generic per-item reason.

**Why this priority**: in the reported run, every item said `skipped: dirty-tree`, which describes the
symptom and not the cause, and hid the fact that the pre-flight had already failed with a precise
error. A diverged base branch is likewise reported as a bare `pull-failed` with no recovery guidance.

**Independent Test**: run a tick whose pre-flight rescue fails and whose base pull fails, and assert
the per-item skip line names both pre-flight failures.

**Acceptance Scenarios**:

1. **Given** a tick whose pre-flight rescue failed, **When** an item is skipped for a dirty tree,
   **Then** the skip line and the item's recorded detail name the rescue step that failed and its
   error text.
2. **Given** a tick whose base fast-forward failed, **When** an item is skipped, **Then** the skip
   line names the base failure separately from any rescue failure.
3. **Given** a tick whose pre-flight succeeded entirely, **When** an item is skipped for a dirty tree,
   **Then** the skip line is unchanged from today's wording.

---

### User Story 4 - The operator knows how to recover a diverged base branch (Priority: P3)

The documented `do-work` reference explains what `pull-failed` on the base branch means, why automata
refuses to resolve it, and the steps an operator takes — including when the local-only commit is an
unwanted generated change.

**Why this priority**: it unblocks a human without changing behaviour, so it is worth doing but is not
the defect.

**Independent Test**: read `docs/do-work.md` and follow the recovery steps against a checkout whose
local base branch has a commit `origin` does not.

**Acceptance Scenarios**:

1. **Given** the `docs/do-work.md` page, **When** an operator hits `pull-failed` on the base branch,
   **Then** the page names the inspection command and both recovery paths (keep the commit, or drop it).

---

### Edge Cases

- The run lock is *tracked* by the repository and also matches `.gitignore`: the exclusion must be
  kept, or the rescue would commit a pid file. `git check-ignore` already answers "not ignored" for a
  tracked path, which is the behaviour this relies on.
- The run lock path does not exist yet (the lock was released, or the check runs before acquisition):
  the exclusion is harmless and is kept.
- `git check-ignore` itself fails (not a repository, git too old): treated as "not ignored", so the
  behaviour is exactly today's.
- The rescue is a dry run: nothing is staged, no branch is created, and the branch the rescue *would*
  create must still not be a prune candidate.
- The rescue target is an existing agent-owned branch rather than a new one: it is already excluded
  from pruning by having a remote, but the protection must not misbehave for it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Staging for the rescue MUST NOT fail because an excluded path is ignored by
  `.gitignore`. An exclusion that git already ignores and does not track MUST be dropped from the
  pathspec, because `git add -A` never stages such a path anyway.
- **FR-002**: When every exclusion has been dropped, staging MUST fall back to the unqualified
  `git add -A` form rather than emitting an empty pathspec.
- **FR-003**: An exclusion for a path that git tracks MUST be kept, even when a `.gitignore` pattern
  matches it, so the run lock is never committed by the rescue.
- **FR-004**: The rescue MUST stage the changes before creating the recovery branch, so a staging
  failure leaves no empty recovery branch behind.
- **FR-005**: The prune phase MUST NOT treat the branch the rescue created (or, in a dry run, would
  create) as a deletion candidate during the same tick.
- **FR-006**: A tick MUST expose its pre-flight rescue failure and its pre-flight base-preparation
  failure as two separate, independently readable causes.
- **FR-007**: When an item is skipped and the pre-flight reported a failure, the skip line and the
  item's recorded detail MUST name the pre-flight failure(s) — the step and the error text — in
  addition to the per-item reason.
- **FR-008**: When the pre-flight reported no failure, the per-item skip wording MUST be unchanged.
- **FR-009**: `docs/do-work.md` MUST document the ignored-run-lock behaviour of the rescue and the
  operator recovery for a base branch that cannot be fast-forwarded, covering both keeping and
  discarding the local-only commit.

### Key Entities

- **Exclusion pathspec**: the set of repository-relative paths the rescue refuses to stage. Currently
  exactly the run lock.
- **Pre-flight failure**: a rescue or base-preparation step that failed, carrying the step name and
  git's error text. Reported by the tick summary and now also on each affected per-item skip.
- **Recovery branch**: the branch the rescue commits onto — either a newly created `rescue/…` branch
  or the agent-owned branch already checked out.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a checkout that gitignores `.automata/automata.lock`, a tick with a dirty tree
  completes the rescue and answers the discovered work, instead of skipping 100% of items.
- **SC-002**: No tick reports creating a recovery branch that does not exist when the tick ends.
- **SC-003**: Every per-item skip caused by a failed pre-flight names that pre-flight failure, so an
  operator can diagnose the tick from its output alone without re-reading the pre-flight section.
- **SC-004**: Existing `do-work` behaviour in checkouts that do not ignore the run lock is byte-for-byte
  unchanged — the same git argv, the same log lines.

## Assumptions

- [AUTO] Ignored-path detection: chose `git check-ignore -q -- <path>` per exclusion because its exit
  status already means "ignored and not tracked", which is exactly the predicate FR-001 and FR-003
  need, and it adds no new dependency.
- [AUTO] Failure of the detection command: chose to treat any non-zero status other than "ignored" as
  "not ignored" (keep the exclusion) because that is the pre-change behaviour and it can never cause
  the lock to be committed.
- [AUTO] Reporting shape: chose to append the pre-flight cause to the existing per-item skip line and
  detail rather than introducing a new per-item skip reason, because `PrepareFailureReason` describes
  what the workspace step observed and the pre-flight is a separate concern that already has its own
  report.
- [AUTO] Prune protection: chose to protect the rescue's target branch for the tick rather than
  changing the deletion rules, because the existing rules ("positive evidence the branch is finished")
  are correct and only the rescue's own in-flight branch is at risk.
- [AUTO] Scope: no change to `git pull --ff-only` behaviour on a diverged base branch — the refusal is
  correct and deliberate; only its reporting and its documentation change.
- Out of scope: automatic resolution of a diverged base branch, any change to the run lock's format or
  location, and any change to the per-item workspace guard.

## Clarifications

- Q: Should the rescue simply force-add the lock, or `git add -A` without any pathspec? → A: Neither;
  drop only the exclusions git already ignores. [AUTO: force-adding would commit a pid file, and
  dropping the pathspec unconditionally would commit the lock in checkouts that do not ignore it.]
- Q: Should a per-item skip gain a new reason such as `preflight-failed`? → A: No; keep the existing
  reasons and append the pre-flight cause. [AUTO: the reasons are a closed union consumed by the
  operation log and the JSON output; widening it is a breaking change for a reporting improvement.]
- Q: Should the base fast-forward failure be retried or resolved? → A: No. [AUTO: the constitution's
  simplicity principle and the module's stated rule — nothing unattended may discard work.]
