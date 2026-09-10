# Feature Specification: Manage orphaned pull requests in `do-work`

**Feature Branch**: `feature/033-orphan-pull-requests`

**Created**: 2026-09-10

**Status**: Draft

**Input**: User description: "Manage orphaned pull requests in do-work: second pass after the issue pass that picks up open PRs closing no issue of this repo, filtered by the same issueDiscoveryTechnique/Value as issues, triggered only by an unanswered message from an authorized account (no first-touch, no head-SHA re-trigger). New turn pr-orphan on the PR head branch, reusing protected-branch and cross-repository/fork refusals. Prompt key doWork.prompts.prOrphan next to issueDiscuss/prWork. --pr N alongside --issue N. Issues first then orphan PRs, sharing one --max-runs budget. JSON entries for orphan PRs have issue: null. Closes #59"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A maintainer asks the agent to deal with a Dependabot pull request (Priority: P1)

Dependabot opens a pull request that bumps a dependency. It closes no issue, so today `do-work`
cannot see it at all: the tick lists issues, and a pull request with no closing reference is only
ever used to answer "does this issue already have a pull request?".

The maintainer adds the repository's discovery label to that pull request and comments on it
("CI is red — rebase onto develop and fix the type error, then tell me whether this is safe to
merge"). The next tick picks the pull request up, checks its head branch out, runs one model
session with the orphan-pull-request instructions, and the agent replies on the pull request.

**Why this priority**: This is the whole point of the request in issue #59, and it is the only
story that delivers value on its own.

**Independent Test**: Configure `issueDiscoveryTechnique: label` / `issueDiscoveryValue: automated`,
label an open pull request that closes no issue, comment on it as an authorized account, and run
`automata do-work --dry-run`. The plan must list the pull request as a `pr-orphan` turn on its head
branch, and the command it would launch must carry the orphan prompt.

**Acceptance Scenarios**:

1. **Given** an open pull request that closes no issue of this repository, carrying the discovery
   label, whose newest authorized message has no agent answer after it, **When** a tick runs,
   **Then** exactly one `pr-orphan` turn runs on that pull request's head branch and the marker is
   posted on the pull request.
2. **Given** the same pull request after the agent has replied, **When** the next tick runs,
   **Then** the pull request is reported as nothing-to-do and no model run happens.
3. **Given** an open pull request that closes no issue and carries the discovery label but whose
   only messages are Dependabot's own body and commits, **When** a tick runs, **Then** no turn is
   started: a pull request with no unanswered authorized message is not work.
4. **Given** a labelled orphan pull request whose head branch is `main` (a release pull request),
   **When** a tick runs, **Then** the item is skipped as an unsafe branch and nothing is checked
   out or pushed.
5. **Given** a labelled orphan pull request opened from a fork, **When** a tick runs, **Then** the
   item is skipped as an unsafe branch, because its head branch is not in this repository.

---

### User Story 2 - An operator budgets and inspects a mixed tick (Priority: P2)

An operator runs `do-work` from cron with `--max-runs 2`. The tick has three issues needing an
answer and two labelled orphan pull requests. The two issues run, and everything after them —
including both pull requests — is reported as `deferred`, so a pile of Dependabot pull requests can
never starve the issues.

**Why this priority**: Without a shared budget in a fixed order, adding the second pass changes how
the existing issue loop behaves under a cap, which is a regression for every current operator.

**Independent Test**: A tick with more actionable items than the cap reports the issue items as run
and the pull-request items as `deferred`, in that order, with the issue items first in the plan.

**Acceptance Scenarios**:

1. **Given** two actionable issues and one actionable orphan pull request with `--max-runs 2`,
   **When** the tick runs, **Then** both issues run and the pull request is reported `deferred`.
2. **Given** the same state with `--max-runs 3`, **When** the tick runs, **Then** all three run,
   issues first.
3. **Given** `--json`, **When** the tick runs, **Then** the orphan pull request's entry carries
   `issue: null` and its pull request number, and every issue entry is unchanged apart from the new
   pull-request field.

---

### User Story 3 - An operator forces a single pull request (Priority: P3)

An operator wants to try one specific pull request without waiting for a whole tick, the way
`--issue N` already lets them target one issue. `automata do-work --pr 61` restricts the tick to
that pull request.

**Why this priority**: A convenience that mirrors an option that already exists; the feature is
usable without it.

**Independent Test**: `automata do-work --pr 61 --dry-run` describes at most that one item and no
issues.

**Acceptance Scenarios**:

1. **Given** `--pr 61` where 61 is an open orphan pull request, **When** the tick runs, **Then**
   only that pull request is considered and no issues are discovered.
2. **Given** `--pr 61` where 61 does not carry the discovery label, **When** the tick runs, **Then**
   a note says so on stderr and the pull request is processed anyway.
3. **Given** `--pr 61` where pull request 61 closes an issue of this repository, **When** the tick
   runs, **Then** the tick refuses with an error naming the issue and pointing at `--issue`.
4. **Given** `--pr 61` where pull request 61 is not open, **When** the tick runs, **Then** the tick
   refuses with an error saying it is not an open pull request.
5. **Given** both `--issue 42` and `--pr 61`, **When** the tick runs, **Then** both passes run,
   each restricted to the named item.

---

### Edge Cases

- **The pull request gained a closing reference between the plan and the run.** A maintainer edits
  the body to add `Closes #42` while an earlier item is running. The item is skipped: it now belongs
  to the issue pass and will be handled there on the next tick with the correct prompt.
- **The pull request was closed or merged between the plan and the run.** The item is skipped; its
  branch has landed or gone.
- **A pull request that closes an issue in a *different* repository.** It closes no issue of *this*
  repository, so it is an orphan here. The existing `nameWithOwner` filter in the link map already
  draws that line, and it is the line this feature keeps.
- **A pull request whose closing reference points at a closed issue.** It has a closing reference,
  so it is not an orphan and this feature ignores it. The issue pass already skips closed issues.
- **`--limit` and the orphan pass.** The orphan candidates come out of the pull-request link map,
  which is already paginated exhaustively and is not governed by `--limit`. `--limit` keeps applying
  to issues only.
- **A draft orphan pull request.** Draft is not a reason to skip: a Dependabot pull request can be a
  draft and still need rebasing. `pr-work` does not consult `isDraft` either.
- **An orphan pull request with unresolved review threads and no conversation comment.** An
  unresolved thread whose newest comment is from an authorized account and which the agent has not
  answered is a trigger, exactly as on `pr-work`.
- **An orphan pull request whose newest authorized message carries `tool:` / `model:`.** The
  directive applies, because it is read from the triggering message and an orphan turn has one.
- **No orphan pull requests at all.** The pass reports nothing and the tick behaves as it does
  today, at exit 0 when the issue pass was clean.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `do-work` MUST run a second discovery pass, after the issue pass, over the open pull
  requests of this repository that declare **no** closing reference to an issue **of this
  repository**.
- **FR-002**: The orphan pass MUST select candidates with the same `issueDiscoveryTechnique` /
  `issueDiscoveryValue` as the issue pass, applied to the pull request: `label` against the pull
  request's labels, `assignee` against its assignees, `title-contains` against its title. Matching
  MUST be case-insensitive, as it already is for issues.
- **FR-003**: An orphan pull request MUST become work **only** when the newest message from an
  account in `allowedUsers` — a conversation comment, a non-empty review body, or a comment in an
  unresolved review thread — is not answered by a later message from `agentUser` on that pull
  request. No other trigger exists: neither a first sighting of the pull request, nor a change of
  head SHA, nor the pull request's own body or commits.
- **FR-004**: A new turn kind `pr-orphan` MUST run on the pull request's head branch, prepared the
  same way a `pr-work` turn's branch is.
- **FR-005**: `pr-orphan` MUST reuse the existing build-turn refusals: a pull request from a fork
  (cross-repository) and a pull request whose head is the base branch, the repository default
  branch, or a configured protected branch are skipped as `unsafe-pr-branch`.
- **FR-006**: The turn instructions MUST be configurable at `doWork.prompts.prOrphan`, resolvable
  from a `.md` filename inside `.automata/` exactly as the other two prompts are, settable with
  `automata config set do-work-prompt pr-orphan <value>`, and reachable from the configuration
  wizard. A built-in default MUST exist so the feature works with no configuration.
- **FR-007**: The prompt handed to the executor MUST omit the issue sections entirely for a
  `pr-orphan` turn — there is no issue — and MUST carry the pull request identity, its conversation
  restricted to authorized accounts and the agent, and its unresolved review threads needing an
  answer.
- **FR-008**: `--pr <number>` MUST restrict the orphan pass to that pull request, warning on stderr
  when it does not match the discovery filter and processing it anyway, mirroring `--issue`.
- **FR-009**: `--issue <number>` alone MUST suppress the orphan pass, and `--pr <number>` alone MUST
  suppress the issue pass. Given both, both passes run, each restricted to the named item.
- **FR-010**: `--pr <number>` MUST fail the tick (exit 1) when the number is not an open pull
  request of this repository, or when it closes an issue of this repository — naming that issue and
  pointing at `--issue`.
- **FR-011**: Issue items and orphan pull-request items MUST share one `--max-runs` /
  `maxRunsPerTick` budget, with issue items offered the budget first. Items beyond the budget MUST
  be reported `deferred`, and only real model runs MUST consume a slot, as today.
- **FR-012**: A `pr-orphan` item MUST NOT be assigned to anyone and MUST NOT trigger the
  issue-pickup note or the pull-request-link repair — both are issue mechanisms and there is no
  issue.
- **FR-013**: The `working…` marker, its reconciliation (delete on answer, update in place
  otherwise), the mid-run overtaken-message report, the oversized-prompt refusal and the invalid
  `tool:` refusal MUST all behave for `pr-orphan` exactly as they do for `pr-work`, with the pull
  request as the surface.
- **FR-014**: An orphan item MUST be re-decided immediately before it runs, as issue items already
  are, and MUST be skipped when the pull request has since been closed, merged, answered, or has
  gained a closing reference to an issue of this repository.
- **FR-015**: `--json` output MUST identify every item unambiguously: `issue` is `null` for an
  orphan item and the pull request number appears in a `pr` field present on every item (`null` for
  a `issue-discuss` item with no pull request).
- **FR-016**: `--dry-run` MUST describe orphan items with the same header and exact command it
  prints for issue items, and MUST respect the shared run cap.
- **FR-017**: Human-readable plan, progress and summary lines MUST name an orphan item by its pull
  request (`PR #61`) rather than by a non-existent issue number.
- **FR-018**: An orphan pull request MUST NOT be worked on when it is also reachable through the
  issue pass — the two passes MUST be disjoint by construction, since a pull request with a closing
  reference to an issue of this repository is never an orphan candidate.

### Key Entities

- **Orphan pull request**: an open pull request of this repository whose GitHub closing references
  contain no issue of this repository. Carries its labels and assignees, so the discovery filter can
  be applied to it.
- **`pr-orphan` turn**: a work item with a pull request and no issue, running on the pull request's
  head branch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A labelled orphan pull request with one unanswered authorized comment produces
  exactly one model run per tick, and zero on the tick after the agent answers.
- **SC-002**: A labelled orphan pull request with no authorized message ever produces zero model
  runs, however many ticks run.
- **SC-003**: The orphan pass costs **no additional GitHub API calls** when no orphan pull request
  matches: the candidates come out of the pull-request link-map query the tick already performs, and
  a pull request's conversation is fetched only once it has matched the filter.
- **SC-004**: With `--max-runs N` and more than N actionable items, exactly N model runs happen and
  the issue items are the ones that run.
- **SC-005**: Every existing `do-work` behaviour on issues is unchanged: the same turns, the same
  refusals and the same exit codes, with `--json` items gaining one field.

## Assumptions

- **[AUTO] Trigger rule**: an orphan pull request is work only when an authorized account has left
  an unanswered message on it — no first-touch turn and no head-SHA re-trigger. Chosen because the
  maintainer decided this explicitly in the issue discussion, and because it keeps one code path
  and one idempotence argument for all three turns.
- **[AUTO] Labelling route**: no change to `.github/dependabot.yml` and no second configured label.
  Since a human must comment to trigger anything, they can add the label in the same action, so the
  label stays a cheap filter that bounds how many pull-request conversations a tick fetches rather
  than the thing that starts work.
- **[AUTO] No assignment on an orphan turn**: `pr-orphan` does not add the agent as an assignee.
  Assignment exists to make the claim visible in the *issue* list, `assignIssueToAgent` is an
  issue-only call, and the discovery filter may itself be `assignee` — where assigning the agent
  would change what the filter matches. The `working…` marker on the pull request is the visible
  claim.
- **[AUTO] Draft pull requests are eligible**: `pr-work` does not consult `isDraft`, and a
  Dependabot pull request may be a draft while still needing work.
- **[AUTO] `--limit` does not apply to the orphan pass**: the link map is already read exhaustively
  (a partial read fails the tick), so there is no page to limit. `--limit` stays an issue-list bound.
- **[AUTO] A pull request closing an issue in another repository is an orphan here**: the link map
  already discards a closing reference whose `nameWithOwner` is not this repository, and this feature
  keeps that definition rather than introducing a second one.
- **[AUTO] `pr` is added to every `--json` item rather than only to orphan items**: a field present
  on some entries and absent on others is harder to consume than one that is always present and
  sometimes `null`, and `issue: null` alone leaves an orphan entry unidentifiable.
- **[AUTO] The orphan pass shares `doWork.protectedBranches` and `doWork.baseBranch`**: no new
  configuration is introduced. A branch unsafe to push to on a `pr-work` turn is unsafe on a
  `pr-orphan` turn for the same reason.
- **[AUTO] The default `prOrphan` prompt tells the model to inspect CI, rebase if needed, and
  recommend merge or close without merging or closing itself**: `do-work` never merges a pull request
  or closes an issue, and the default prompt must not ask the model to do what the command documents
  it never does.

## Clarifications

- Q: Does the orphan pass need its own fetch limit, like `--limit` for issues? → A: No. [AUTO: the
  candidates come from the exhaustively paginated link map the tick already performs, so there is no
  page to bound; the discovery filter is what bounds how many conversations get fetched.]
- Q: How is an orphan item identified in the human-readable plan, progress lines and summary, where
  every line today starts with `#<issue>`? → A: `PR #<number>`. [AUTO: printing `#61` would be
  indistinguishable from issue 61, and this is a log an operator reads out of cron mail.]
- Q: Does `--issue N` still run the orphan pass? → A: No, and `--pr N` alone suppresses the issue
  pass; given both, both passes run restricted. [AUTO: `--issue N` is documented as "restrict the
  tick to a single issue", so silently adding a pull-request pass to it would contradict the option
  that already ships.]
- Q: Does a `pr-orphan` turn assign anything to the agent? → A: No. [AUTO: `assignIssueToAgent` is an
  issue call, the claim exists to be visible in the issue list, and with `issueDiscoveryTechnique:
  assignee` assigning the agent would change what the discovery filter matches.]
- Q: What happens when a `--pr N` target is not an orphan (it closes an issue of this repository)? →
  A: The tick fails with exit 1, naming the issue and pointing at `--issue`. [AUTO: processing it as
  an orphan would run the wrong prompt on a pull request that the issue pass owns, and silently
  ignoring the operator's explicit target is worse than an error.]
