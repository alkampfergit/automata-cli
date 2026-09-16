# Feature Specification: Claim an unassigned issue and pull request for the agent

**Feature Branch**: `feature/033-assign-when-unassigned`

**Created**: 2026-09-10

**Status**: Draft

**Input**: User description: "Assign the agent identity to an issue and to its pull request only when nobody is assigned yet. Issue #57."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An unassigned issue picked up by the loop shows who is on it (Priority: P1)

A maintainer scans the repository's issue list. Some issues are being worked on by
the autonomous loop right now, some are waiting. Today the loop's claim is visible
only in a `working…` comment buried in the conversation, and the assignee column is
inconsistent: the agent is added even to issues a colleague already owns.

After this change the assignee column carries one clear meaning: an issue with no
assignee is unclaimed, and an issue the loop has picked up shows the agent account —
unless a human already owns it, in which case their name is left untouched and the
agent does not add itself.

**Why this priority**: This is the behaviour the issue asks for on the surface where
the loop already acts. It is deliverable on its own and immediately changes what the
issue list means.

**Independent Test**: Run one `do-work` tick against an issue with no assignees and
confirm the agent account appears; run it against an issue assigned to a human and
confirm the assignee list is unchanged.

**Acceptance Scenarios**:

1. **Given** an open issue with an empty assignee list that the loop decides to work
   on, **When** the tick claims it, **Then** the agent account is added as an
   assignee.
2. **Given** an open issue already assigned to a human, **When** the tick works on
   it, **Then** no assignee is added or removed and no claim is attempted.
3. **Given** an open issue already assigned to the agent account, **When** the tick
   works on it, **Then** no assignee call is made (it is already claimed).
4. **Given** an issue with no assignees in a repository where the agent has no write
   access, **When** the claim fails, **Then** a warning is printed and the turn
   continues to completion.

---

### User Story 2 - The pull request carries the same claim as the issue (Priority: P1)

The same maintainer scans the pull request list. A pull request opened by the model
has nobody in the assignee column, so it is indistinguishable from a stale human
draft. After this change a pull request the agent works on — one it just opened
during a discuss turn, or one it answers review feedback on during a build turn —
shows the agent account, and a pull request somebody has already taken is left alone.

**Why this priority**: The issue asks for the same rule "for any opened pull request
from that issue". Without it the claim is only half visible, because most of the
loop's later ticks happen on the pull request, not the issue.

**Independent Test**: Run a `do-work` build turn on a pull request with no assignees
and confirm the agent account appears; repeat with an assignee already present and
confirm nothing changes.

**Acceptance Scenarios**:

1. **Given** a build turn on an open pull request with an empty assignee list,
   **When** the tick claims it, **Then** the agent account is added as an assignee.
2. **Given** a build turn on a pull request that already has any assignee, **When**
   the tick runs, **Then** the assignee list is unchanged.
3. **Given** a discuss turn where the model opened a pull request, **When** the tick
   reconciles the `Closes #N` link afterwards, **Then** the new pull request is
   claimed for the agent if it has no assignees.
4. **Given** a pull request claim that fails, **When** the failure is reported,
   **Then** a warning is printed and the turn's outcome is unaffected.

---

### User Story 3 - The claim is visible before it happens (Priority: P2)

An operator inspects what a tick would do with `automata do-work --dry-run` before
letting it run unattended. The plan already says whether the issue would be
assigned; it must say the same about the pull request, and it must not claim to
assign an issue that a human already owns.

**Why this priority**: The dry run is the documented way to audit the loop. It is a
reporting change on top of stories 1 and 2, so it can ship after them, but a plan
that misdescribes the claim is worse than no plan.

**Independent Test**: Run `automata do-work --dry-run` over an issue/pull-request
pair in each assignment state and read the printed plan.

**Acceptance Scenarios**:

1. **Given** an issue with no assignees, **When** the plan is printed, **Then** it
   states that the issue would be assigned to the agent account.
2. **Given** an issue with any assignee, **When** the plan is printed, **Then** it
   states the issue is already assigned and no claim is planned.
3. **Given** a build turn on an unassigned pull request, **When** the plan is
   printed, **Then** it states the pull request would be assigned to the agent.
4. **Given** a dry run, **When** it completes, **Then** nothing was actually
   assigned.

---

### User Story 4 - A manually picked-up issue's pull request is claimed too (Priority: P3)

A developer runs `automata implement-next`, picks an issue, and the model opens a
pull request. The command already comments on the issue and appends `Closes #N` to
the pull request; it should also claim the pull request for the running identity when
nobody is assigned, so a manually started piece of work looks the same in the pull
request list as a loop-started one.

**Why this priority**: Consistency on a second surface. Valuable but not what the
issue is primarily about, and independent of the loop behaviour.

**Independent Test**: Run `implement-next` on an issue, let it open a pull request,
and confirm the pull request gains the running identity as assignee.

**Acceptance Scenarios**:

1. **Given** `implement-next` opened a pull request with no assignees, **When** the
   post-run reconciliation happens, **Then** the pull request is assigned to the
   configured agent identity.
2. **Given** a pull request that already has an assignee, **When** the same
   reconciliation happens, **Then** the assignee list is unchanged.
3. **Given** the claim fails, **When** it is reported, **Then** a warning is printed
   and the command's exit code is unaffected.

---

### Edge Cases

- **The agent is not among a non-empty assignee list.** Nothing happens. "Assigned
  to somebody" is enough; the agent does not add itself alongside a human, which is
  a deliberate change from today's behaviour.
- **A team or non-user assignee.** Any entry in the assignee list counts as
  assigned; the rule never inspects who the assignee is.
- **The agent lacks write access.** Every claim is advisory: it warns and the turn
  continues. A repository where the loop can only comment must stay usable.
- **The issue is assigned but its pull request is not (or the reverse).** The two
  surfaces are decided independently; each is claimed only if it is itself empty.
- **A pull request opened during a discuss turn.** Its assignee state is not known
  when the plan is built, so the claim happens after the run, where the new pull
  request is first seen.
- **Somebody assigns themselves mid-run.** The claim decision is made from the state
  read at the start of the item, so a race can add the agent next to a human who
  arrived seconds earlier. Accepted: additive, harmless, and self-correcting on the
  next tick.
- **A closed or merged pull request.** Not claimed — the loop already treats it as
  no pull request at all.
- **A fork's pull request.** Already skipped as an unsafe head branch before any
  claim would be reached.

## Clarifications

### Session 2026-09-10 (issue #57 discussion + autonomous)

- Q: Who is "the actual user" the issue asks to assign — the issue author, or the
  author of the triggering message? → A: Neither. The agent identity itself. Answered
  by the maintainer on issue #57: "actual user is the user of the agent … if the issue
  is already assigned, do nothing, but if the issue is not assigned it is normal to
  assign to the identity of the agent (that is doing the work)".
- Q: Does the agent add itself to an issue a human already owns? → A: No. A non-empty
  assignee list is left completely untouched. Answered by the maintainer, and it
  reverses today's behaviour.
- Q: Is the pull request claimed only when the agent just opened it, or on every turn
  that works on it? → A: On every turn that works on it, if it has no assignees.
  [AUTO: the build turn already reads the pull request's state to decide the turn, so
  the check is free there, and a pull request the loop is actively pushing to should
  not read as unclaimed.]
- Q: What happens when the claim call fails (no write access)? → A: Warn and continue,
  identical to today's issue claim. [AUTO: matches the existing advisory `claimIssue`
  and the constitution's requirement that the loop stay usable read-only.]
- Q: Does `implement-next` also claim the issue? → A: No, only the pull request it
  caused to be opened. [AUTO: conservative scope — issue claiming on a human-driven
  command was not requested; recorded as deferred.]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The loop MUST assign the agent identity to an issue it works on when,
  and only when, that issue has no assignees at all.
- **FR-002**: The loop MUST NOT add, remove or replace any assignee on an issue that
  already has at least one assignee — including when the existing assignee is not the
  agent.
- **FR-003**: The loop MUST assign the agent identity to the pull request it works on
  during a build turn when, and only when, that pull request has no assignees.
- **FR-004**: The loop MUST assign the agent identity to a pull request first seen
  after a discuss turn (the one carrying `Closes #<issue>`) when that pull request has
  no assignees.
- **FR-005**: Every assignment MUST be additive — it MUST NOT clear or overwrite an
  existing assignee list — and MUST be skipped entirely when the list is non-empty.
- **FR-006**: Every assignment MUST be advisory: a failure MUST be reported as a
  warning and MUST NOT change the item's outcome, the tick's exit code, or prevent
  any later step.
- **FR-007**: The work plan (human-readable and `--json`) MUST report, per item,
  whether the issue and the pull request would be claimed.
- **FR-008**: A dry run MUST NOT assign anything.
- **FR-009**: `implement-next` MUST claim the pull request it caused to be opened for
  the configured agent identity when that pull request has no assignees, advisorily.
- **FR-010**: The documented behaviour in `docs/do-work.md` MUST describe the
  "assign only when unassigned" rule for both surfaces, replacing the current
  description of the issue claim.

### Key Entities

- **Assignee list**: the set of accounts GitHub reports as assigned to an issue or a
  pull request. Only its emptiness is consulted; membership is never tested.
- **Agent identity**: the configured `agentUser` account — the same identity the loop
  authors comments as, and the one `do-work` already verifies `gh` is authenticated
  as.
- **Claim**: the additive act of adding the agent identity to an empty assignee list,
  on either surface.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every issue and pull request the loop touches, the assignee column
  answers "is anyone on this?" correctly: empty means unclaimed, non-empty means
  claimed by whoever is listed.
- **SC-002**: Zero assignments are made to an issue or pull request that already had
  an assignee — verifiable from the tick log, which reports each claim it makes.
- **SC-003**: A tick in a repository where the agent cannot assign completes with the
  same outcome and exit code it has today, with one warning line per failed claim.
- **SC-004**: `automata do-work --dry-run` names both planned claims before any tick
  runs, and performs none of them.

## Assumptions

- [AUTO] **Which identity is assigned**: the configured `agentUser`, on both
  surfaces, because the maintainer settled this in the issue discussion ("it is
  normal to assign to the identity of the agent that is doing the work") and
  `do-work` already verifies `gh` is authenticated as that account.
- [AUTO] **"Nobody is assigned" means the list is empty**, not "the agent is not in
  the list". This is the stated rule and it changes today's behaviour, where the agent
  is added to an issue a human already owns.
- [AUTO] **Build turns claim the pull request too**, not only the discuss turn that
  opened it: the build turn is the loop working on that pull request, and its assignee
  state is already read as part of deciding the turn, so the rule costs nothing there.
- [AUTO] **Membership is never tested**, so the case-insensitive login comparison
  used today for the issue claim is no longer needed on the claim path.
- [AUTO] **`implement-next` claims the pull request only**, not the issue. Issue
  claiming on that command was not part of the request and would change a
  human-driven command's side effects; it is recorded as deferred rather than added.
- [AUTO] **A missing `agentUser` on `implement-next`** falls back to the
  authenticated `gh` user, because `agentUser` is optional for that command (unlike
  `do-work`, which refuses to run without it) and the running identity is the correct
  claimant there.
- Out of scope: assigning humans (the issue author or the author of the triggering
  comment), removing assignees, reassigning a stale claim, and any change to how the
  loop discovers issues by assignee.
