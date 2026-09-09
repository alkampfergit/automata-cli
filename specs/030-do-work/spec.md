# Feature Specification: `do-work` Autonomous Orchestrator

**Feature Branch**: `feature/030-do-work`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "The goal is to build a tool used in a VM or codespaces container as a harness for an SDD process based on GitHub or Azure DevOps. Authorized persons write issues on GH and label them with a special label meaning the issue should be implemented by a model. We can go fully automated from the issue to implementation, or start an SDD process based on the issue conversation. Everything should be mediated by skills that drive the model. automata must be runnable under cron: it monitors the repository of the current folder, determines what to do next, and drives the model. A single command, `do-work`. It should: (1) check for open issues with the configured label; (2) process them one by one; (3) know the identity of the current agent and check every issue for work to do, meaning the last message is not from the agent so the agent should answer; (4) distinguish between a first SDD phase where no code is written and we talk in the issue about spec/plan, and the later phase where it is time to implement on a new branch with a pull request. The purpose of automata is to orchestrate everything, reducing calls to models — calling the model only to perform work."

**Clarified scope**: For an open issue carrying the configured label, `do-work` decides there is work when the newest message from an *authorized* account is newer than the agent's own newest message. Comments from accounts that are not authorized are ignored entirely — for detection and for prompt content. If the issue has a linked pull request, the pull request is inspected under the same rules. When `do-work` first takes an issue it assigns the issue to the agent identity before invoking the model. The marker comment is transient: it says "working…" before the run, and afterwards `do-work` checks whether the model actually posted an answer — deleting the marker when it did, and updating it to explain what happened when it did not. Only one automata instance may run at a time in a repository. The turn instructions come from prompts held in configuration; those prompts name whichever skill the model should use, and this feature authors no skills. `do-work` is a self-contained process, unrelated to the existing, more specific commands.

## Assumptions

- [AUTO] `do-work` is a new top-level command (`automata do-work`) that shares only low-level services with the existing commands. `implement-next` and `execute-prompt *` keep working unchanged and are not deprecated by this feature; they remain the manual, single-purpose escape hatches. Rationale: the user stated `do-work` is "a process on its own unrelated to any other existing commands that are more specific".
- [AUTO] GitHub-only in this feature. Azure DevOps is rejected with a pointer to `docs/azdo-gap.md`, matching `implement-next` and `execute-prompt check-issue`, because work-item conversation retrieval is not available through `azdo-cli`. The turn-detection core is kept remote-agnostic so an azdo backend can be added later without redesign.
- [AUTO] "Authorized account" reuses the existing `allowedUsers` configuration key, and "the agent" reuses `agentUser`. No parallel trust list is introduced.
- [AUTO] The last-run boundary is derived from the conversation itself (the agent's newest message on that surface), never from local state, so the same behaviour survives across VMs, containers and CI runners. This follows the decision already taken in feature 029.
- [AUTO] Talk-versus-build is decided by pull-request existence, not by intent classification: an issue with no open linked PR gets a discuss turn where the model must not modify files unless an authorized message in that turn asks it to implement; an issue with an open linked PR gets a build turn on that PR's branch. `do-work` therefore never needs a classifier call, honouring "reducing calls to models".
- [AUTO] The issue↔PR link is the GitHub closing reference (`Closes #N`), read through the GraphQL `closingIssuesReferences` field. This is already how `implement-next` links work, so existing repositories keep working.
- [AUTO] Because the link *is* the state machine, `do-work` repairs it: after a turn that could have created a pull request, if the current branch has a PR that is not linked to the issue, the closing reference is added.
- [AUTO] Assignment is the visible claim on an issue, and the marker comment is the boundary record; they serve different purposes and both are kept. Assignment is idempotent and advisory (a failure warns and the turn proceeds), while a failed marker comment aborts the item, because only the marker prevents the same message from being answered twice.
- [AUTO] The marker is transient scaffolding, not a permanent record. It exists to hold the boundary during the run; once the model has posted its own answer, that answer holds the boundary and the marker is noise, so it is deleted. When the model posts nothing, the marker is the only thing that can tell the humans what happened, so it is updated in place rather than removed.
- [AUTO] "The model posted an answer" means a message authored by the agent on the answering surface, created after the marker and distinct from it. On a pull request an agent reply inside a review thread counts as an answer, not only a top-level comment.
- [AUTO] The marker is only ever deleted after the answer has been confirmed to exist, never before, because deleting it without an answer would move the boundary backwards and cause the same message to be answered again on the next tick.
- [AUTO] Updating the marker keeps its creation timestamp, so a run that produced no answer still holds the boundary and is not retried automatically. The updated text is therefore what tells an authorized human that a reply is needed — this is deliberate, because an automatic retry of a failing run is the one behaviour an unattended loop must not have.
- [AUTO] The turn instructions live in configuration as prompt text (or a `.md` file reference), with built-in defaults, so `do-work` works out of the box and a repository can change agent behaviour without a CLI release. The prompt text is where a skill is named; automata itself has no concept of a skill.
- [AUTO] This feature authors no skills. The default prompts reference skills by name only if the operator's configuration does; the shipped defaults are self-contained and name none, so `do-work` never depends on a plugin being installed.
- [AUTO] One tick processes every issue that needs work, sequentially, one model run per work item, then exits. A failed item does not abort the tick.
- [AUTO] On the pull-request surface, both unresolved inline review threads and top-level PR conversation comments count as messages, filtered to authorized accounts. Bot reviewers (Copilot, SonarCloud) are ignored by `do-work`; they are already served by `execute-prompt sonar` and `execute-prompt fix-comments`.
- [AUTO] `do-work` is designed for an isolated, disposable environment and therefore invokes the executor with permission prompts bypassed, exactly as the existing `execute-prompt` subcommands already do. This is documented as an operational precondition rather than made optional.
- [AUTO] The run lock is repository-scoped and named for automata as a whole, not for `do-work` alone, so that other long-running commands can adopt it later without a second lock format. In this feature only `do-work` acquires it.
- [AUTO] `do-work` never merges a pull request, never closes an issue and never pushes to the base branch. Landing stays a human action (or a later feature).
- [AUTO] The process documentation is authored in-repo under `docs/wiki/`, with page filenames chosen so the directory can be published verbatim to the repository's GitHub wiki. In-repo keeps it reviewable in the same pull request as the behaviour it describes; the existing `docs/<group>.md` pages stay terse command references, per the documentation convention in `AGENTS.md`.

## Clarifications

- Q: How does `do-work` know whether a turn is talk-only or build? → A: By pull-request existence — no linked open PR means discuss, a linked open PR means build on its branch; the model creates the PR itself when asked to [AUTO: keeps detection deterministic and free of extra model calls, and makes the state visible in the GitHub UI].
- Q: How are the turn instructions handed to the model? → A: From prompts held in configuration; those prompts name whichever skill should be used, and automata authors no skills [user-selected].
- Q: What does one cron tick do when several issues need an answer? → A: Process all of them sequentially, one model run each, then exit [user-selected].
- Q: Which pull-request comments count as a message needing an answer? → A: Unresolved inline review threads plus top-level PR conversation comments, restricted to authorized accounts; bot reviewers are ignored [user-selected].
- Q: When is there "work to do" on a surface? → A: When the newest message from an authorized account on that surface is newer than the agent's newest message on the same surface [user-clarified].
- Q: Do comments from accounts that are neither authorized nor the agent have any effect? → A: None — they neither trigger a turn nor appear in the prompt [user-clarified].
- Q: Does `do-work` claim an issue visibly? → A: Yes — when it first takes an issue it assigns the issue to the agent identity before invoking the model [user-clarified].
- Q: How strict is the run lock? → A: While one automata instance is running in the repository, no other instance starts work [user-clarified].
- Q: What happens to the marker comment after the run? → A: If the model posted an answer, the marker is deleted; if it posted nothing, the marker is updated to say what happened [user-clarified].
- Q: Does an agent reply inside a review thread count as an answer on a build turn? → A: Yes [AUTO: it is a reply to the reviewer on the surface the turn was answering; requiring a top-level comment as well would make the model post noise].
- Q: If the model posted nothing and the marker is updated, does the next tick retry? → A: No — the updated marker keeps its creation time and so still holds the boundary; the updated text asks the humans for input [AUTO: an unattended loop that automatically retries a failing run burns model calls indefinitely on the same broken input].
- Q: An unresolved review thread whose last comment is the agent's own reply — does it need an answer? → A: No. A thread is answered when the agent spoke last, even if the thread is still marked unresolved, because resolving is the reviewer's action [AUTO: otherwise every unresolved thread would retrigger a turn forever].
- Q: What if both the issue and its pull request have new authorized messages in the same tick? → A: One turn, on the pull request, with the new issue messages included in the context [AUTO: a single model run with the full picture is cheaper and avoids two agents racing on the same branch].
- Q: What if the linked pull request is merged or closed but the issue is still open with a new message? → A: Treated as having no PR, so the turn is a discuss turn [AUTO: the branch is gone or landed; the model must not push to a closed PR, and a discussion turn lets the humans say what comes next].
- Q: What happens when the working tree is dirty at the start of a work item? → A: The item is skipped with a warning and the tick continues [AUTO: `do-work` must never discard uncommitted human work].
- Q: What if assignment fails — for example the agent account has no write access? → A: Warn and proceed with the turn [AUTO: assignment is signalling; refusing the turn over it would stall the whole loop on a permissions detail that does not affect correctness].

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Take a new issue and answer it with no code yet (Priority: P1)

A maintainer opens an issue, labels it `automated`, and describes what they want. On the next cron tick `do-work` finds the issue, sees no linked pull request and a message from an authorized account newer than anything the agent has said, assigns the issue to the agent identity so everyone can see it is taken, and runs the model with the configured discuss prompt. The model replies on the issue with a specification proposal and writes no code.

**Why this priority**: This is the SDD front half — the reason the tool exists. Without it there is no conversation phase.

**Independent Test**: With one labelled open issue, no linked PR, and an authorized comment newer than the agent's last comment, verify the issue is assigned to the agent, the model is invoked once with the configured discuss prompt and an explicit no-code constraint, and no branch is created.

**Acceptance Scenarios**:

1. **Given** a labelled open issue with no linked pull request whose newest authorized message is newer than the agent's newest message, **When** a tick runs, **Then** the model is invoked exactly once with the configured discuss prompt and a context containing the issue number, title, URL and the filtered conversation.
2. **Given** the same issue with no assignee, **When** the tick processes it, **Then** the issue is assigned to the agent identity before the model is invoked.
3. **Given** the same issue already assigned to the agent identity, **When** the tick processes it, **Then** no assignment call is made and the turn proceeds.
4. **Given** an issue whose assignment fails, **When** the tick processes it, **Then** a warning is reported and the turn still proceeds.
5. **Given** the same issue, **When** the prompt is composed, **Then** it states that the turn must not modify files and that the answer belongs on the issue.
6. **Given** the same issue, **When** the tick runs, **Then** a "working" marker comment is posted as the agent account before the model is invoked.
7. **Given** a finished run where the model posted its own comment on the issue after the marker, **When** the item is reconciled, **Then** the marker comment is deleted and the model's answer remains as the newest agent message.
8. **Given** a finished run where the model posted nothing, **When** the item is reconciled, **Then** the marker comment is updated in place to report that the run finished without an answer, and it is not deleted.
9. **Given** a failed run, **When** the item is reconciled, **Then** the marker comment is updated to report the failure.
10. **Given** a run whose answer was posted, **When** deleting the marker fails, **Then** a warning is reported and the item is still counted as answered.
11. **Given** a labelled open issue whose newest message is the agent's own, **When** a tick runs, **Then** no model run happens for that issue and no assignment is made.
12. **Given** a labelled open issue whose only newer comments come from accounts that are neither authorized nor the agent, **When** a tick runs, **Then** no model run happens for that issue and those comments appear nowhere in any prompt.

---

### User Story 2 - Move from discussion to implementation (Priority: P1)

After a few rounds of spec discussion an authorized maintainer writes "the plan looks good, go ahead and implement it". `do-work` still sees an issue with no linked pull request, so it runs a discuss turn — but the configured discuss prompt tells the model that an explicit go-ahead means create the branch, implement, and open a pull request. From the next tick on, the issue has a linked PR and every turn is a build turn on that branch.

**Why this priority**: This is the hand-off between the two phases; without it the loop never reaches code.

**Independent Test**: Run a turn on an issue with no PR, have the model create a branch and PR, and verify `do-work` detects the new PR afterwards, ensures the closing reference to the issue exists, and reports the link.

**Acceptance Scenarios**:

1. **Given** a turn on an issue with no linked pull request, **When** the run finishes and the current branch now has a pull request that has no closing reference to the issue, **Then** `do-work` adds the closing reference so the link exists for the next tick.
2. **Given** the same situation, **When** the run finishes and the pull request already closes the issue, **Then** the body is left untouched.
3. **Given** a turn on an issue with no linked pull request, **When** the run finishes and no pull request exists, **Then** the tick reports the issue as still in discussion and changes nothing.

---

### User Story 3 - Answer reviewer feedback on the pull request (Priority: P1)

A pull request opened for issue #42 receives an unresolved inline review comment from an authorized maintainer. On the next tick `do-work` finds the issue, resolves its linked pull request, sees an unresolved thread whose last comment is from an authorized account, checks out the PR branch and runs the model with the configured build prompt so the feedback is addressed, committed and pushed.

**Why this priority**: Feedback rounds are where most of the work happens; a loop that cannot answer review comments stalls on the first review.

**Independent Test**: With a labelled issue linked to an open pull request carrying one unresolved authorized thread, verify the PR branch is checked out and the model is invoked once with the configured build prompt and the thread contents.

**Acceptance Scenarios**:

1. **Given** a linked open pull request with an unresolved review thread whose last comment is from an authorized account, **When** a tick runs, **Then** the model is invoked once with the configured build prompt and a context containing the thread's file, line and body.
2. **Given** a linked open pull request whose only new message is a top-level conversation comment from an authorized account, **When** a tick runs, **Then** a build turn runs for that pull request.
3. **Given** a linked open pull request whose unresolved threads all have the agent as their last commenter, **When** a tick runs, **Then** no model run happens for that issue.
4. **Given** a linked open pull request whose only new comments come from bot reviewers, **When** a tick runs, **Then** no model run happens for that issue.
5. **Given** a build turn, **When** the prompt is composed, **Then** it names the pull request number, URL and head branch, and instructs the model to commit and push on that branch and answer on the pull request.
6. **Given** a build turn, **When** the tick starts the item, **Then** the pull request's head branch is checked out and brought up to date before the model is invoked.
7. **Given** a build turn on an issue not yet assigned to the agent, **When** the tick processes it, **Then** the issue is assigned to the agent identity before the model is invoked.
8. **Given** a build turn where the model replied inside a review thread but posted no top-level comment, **When** the item is reconciled, **Then** that reply counts as an answer and the marker is deleted.

---

### User Story 4 - Drain a queue of several issues in one tick (Priority: P2)

Three labelled issues need answers: one in discussion, one whose PR has review comments, one where a maintainer replied on the issue while a PR is already open. One tick handles all three, one model run each, and reports a per-item outcome.

**Why this priority**: A cron-driven harness must drain its queue rather than starving the second item until the next firing.

**Independent Test**: With three issues in the three states, verify three model runs happen in order and the summary reports one line per item.

**Acceptance Scenarios**:

1. **Given** three issues needing work, **When** a tick runs, **Then** three model runs happen sequentially and the command exits 0.
2. **Given** three issues needing work where the second model run fails, **When** a tick runs, **Then** the third item is still processed, the failure is reported, and the command exits non-zero.
3. **Given** an issue with new authorized messages on both the issue and its linked pull request, **When** a tick runs, **Then** exactly one build turn runs for that issue and the new issue messages are included in its prompt.
4. **Given** more work items than the configured per-tick cap, **When** a tick runs, **Then** only the capped number of items run and the remainder are reported as deferred.

---

### User Story 5 - Inspect what a tick would do without spending a model call (Priority: P2)

Before wiring cron, an operator runs `automata do-work --dry-run` to see the work plan: which issues need an answer, which turn each would get, and why. Nothing is assigned, nothing is posted and no model is invoked.

**Why this priority**: An unattended loop that cannot be inspected cannot be trusted; this is also the primary debugging tool while developing the feature.

**Independent Test**: Run with `--dry-run` against a repository with work pending and verify the plan is printed, nothing is assigned or posted, and no executor is spawned.

**Acceptance Scenarios**:

1. **Given** pending work, **When** `--dry-run` is used, **Then** the work plan is printed, no assignment is made, no marker comment is posted, no branch is changed, no executor is spawned, and the command exits 0.
2. **Given** pending work, **When** `--json` is used, **Then** the work plan is emitted as JSON on stdout, with human-readable progress on stderr.
3. **Given** no pending work, **When** a tick runs, **Then** a "nothing to do" message is written and the command exits 0.

---

### User Story 6 - Safe under cron (Priority: P2)

The operator adds `automata do-work` to a five-minute cron schedule. While one automata instance is running in the repository no other instance may start work, and a crashed instance must not block the loop forever.

**Why this priority**: Two concurrent instances in one checkout would corrupt branches and produce conflicting pushes.

**Independent Test**: Start a tick, attempt a second tick while the first holds the lock, and verify the second exits without doing work; then verify a stale lock is reclaimed.

**Acceptance Scenarios**:

1. **Given** an automata instance already holding the repository lock, **When** a second instance starts, **Then** it reports that another instance is running, does no work and exits 0.
2. **Given** a lock left behind by a dead process, **When** a tick starts, **Then** the stale lock is reclaimed and work proceeds.
3. **Given** a tick that finishes, fails, or is interrupted, **When** it exits, **Then** the lock is released.

---

### User Story 7 - Understand and operate the harness from the documentation (Priority: P1)

A new operator — or a maintainer returning after a month — needs to understand what the harness does before trusting it with a repository: who is allowed to command the agent, what makes a turn happen, how an issue travels from a description to a merged pull request, how to configure the prompts, and what to do when the loop appears stuck. They read the wiki and can set the harness up and reason about its behaviour without reading the source.

**Why this priority**: The whole feature is a process, not a command. An unattended loop that nobody can reason about will be turned off after the first surprise; the existing per-command reference pages cannot carry a process explanation.

**Independent Test**: Hand the wiki to someone who has never seen the repository and have them configure the harness on a fresh repository and predict, for three example issue states, which turn a tick would run.

**Acceptance Scenarios**:

1. **Given** the wiki, **When** a reader looks for the trigger rule, **Then** they find the authorization filter, the agent boundary and the full turn decision table stated explicitly.
2. **Given** the wiki, **When** a reader follows the setup page on a fresh repository, **Then** they reach a working `automata do-work --dry-run` without consulting the source.
3. **Given** the wiki, **When** a reader wants to change agent behaviour, **Then** they find the prompt contract: what automata assembles, what the configured prompt is responsible for, and where to name a skill.
4. **Given** the wiki, **When** the loop appears stuck, **Then** they find a symptom-to-cause page covering at least: nothing happens, the same message is answered twice, the agent answers its own messages, an issue stays in discussion after a go-ahead, and items are skipped.
5. **Given** the wiki, **When** a reader asks what the harness will never do, **Then** they find the safety boundaries stated in one place.

---

### Edge Cases

- Configuration incomplete (no discovery filter, no `allowedUsers`, no `agentUser`) → refuse the whole tick with an actionable message; do not half-run.
- A configured prompt names a `.md` file that does not exist or escapes `.automata/` → refuse the tick, because a silent fallback to the default would change agent behaviour invisibly.
- `remoteType` is `azdo` → refuse with a pointer to `docs/azdo-gap.md`.
- `gh` missing or unauthenticated → refuse the tick with the underlying error.
- The agent has never spoken on an issue → the newest authorized message is new by definition, so a first turn runs.
- The agent account also appears in `allowedUsers` → agent messages are never counted as new, so the marker comment cannot retrigger the loop.
- The agent account cannot be assigned (no write access, or not a repository collaborator) → warn and proceed.
- The issue is already assigned to a human → the agent adds itself as an assignee rather than replacing anyone.
- Issue discovery is configured by assignee → self-assignment keeps the issue inside its own discovery filter, which is consistent; discovery by label is unaffected either way.
- An issue is linked to more than one open pull request → the most recently updated one is used and the ambiguity is reported.
- A pull request's head branch cannot be checked out (dirty tree, missing remote branch) → skip that item with a warning and continue the tick.
- The working tree is dirty at the start of an item → skip the item with a warning; never stash or discard.
- The marker comment cannot be posted → skip that item without invoking the model, so the message is retried on the next tick rather than answered silently.
- The marker comment cannot be deleted after a confirmed answer → warn; the item still counts as answered, and the stale marker is harmless because the model's own newer answer holds the boundary.
- The marker comment cannot be updated after a run with no answer → warn; the boundary still holds, but the humans are not told, so the warning must name the issue and the failure.
- The model posted an answer *and* the run exited non-zero → the answer is what matters: the marker is deleted and the item is reported as answered with the non-zero exit noted.
- The model deleted or edited the marker itself → treat a missing marker as already removed and continue; never recreate it.
- An issue is closed between discovery and processing → skip it.
- Timestamps tie exactly between the agent's message and an authorized message → not new (strict inequality), so the loop cannot re-trigger on its own marker.

## Requirements *(mandatory)*

### Functional Requirements

**Command surface**

- **FR-001**: The CLI MUST expose a top-level `automata do-work` command that performs one complete tick and exits.
- **FR-002**: `do-work` MUST accept `--with <claude|codex>`, `--model <string>`, `--issue <number>` (restrict the tick to one issue), `--limit <n>` (issues fetched), `--max-runs <n>` (cap model runs this tick), `--dry-run`, `--json` and `--silent`.
- **FR-003**: `do-work` MUST NOT modify the behaviour of `implement-next` or any `execute-prompt` subcommand, and MUST NOT depend on their command modules.
- **FR-004**: `do-work` MUST exit 0 when the tick completes with every work item answered (including when there is nothing to do and when another instance holds the lock), 1 when a precondition or configuration check fails before any work, and 2 when the tick ran but at least one work item ended in any outcome other than `answered` — failed, skipped, deferred, or finished without posting a reply. A run that produced no reply is degraded rather than healthy, because a human must reply before anything more happens on that issue.

**Preconditions**

- **FR-005**: `do-work` MUST refuse the tick when `remoteType` is not `gh`, naming `docs/azdo-gap.md`.
- **FR-006**: `do-work` MUST refuse the tick when the issue discovery technique or value, `allowedUsers`, or `agentUser` is missing or empty, naming the command that sets each one.
- **FR-007**: `do-work` MUST refuse the tick when a configured prompt cannot be resolved (missing `.md` file, or a path escaping `.automata/`), rather than falling back to the built-in default.

**Discovery**

- **FR-008**: `do-work` MUST list open issues using the configured issue discovery technique and value, honouring `--limit`, and MUST report when the result was truncated by the limit.
- **FR-009**: `do-work` MUST resolve, for every discovered issue, whether an open pull request declares a closing reference to it, and MUST do so for the whole set rather than per issue.
- **FR-010**: When `--issue <number>` is given, `do-work` MUST process only that issue, MUST still apply every detection rule to it, and MUST report if it does not match the configured discovery filter.

**Turn detection**

- **FR-011**: For each surface (issue, pull request) `do-work` MUST compute the agent boundary as the newest message authored by `agentUser` on that surface, and MUST treat a message as new when its author is in `allowedUsers`, is not `agentUser`, and its timestamp is strictly newer than that boundary.
- **FR-012**: Messages authored by accounts that are neither in `allowedUsers` nor `agentUser` MUST be excluded from detection and MUST NOT appear in any composed prompt.
- **FR-013**: Author matching MUST be case-insensitive.
- **FR-014**: An issue with no linked open pull request and at least one new issue message MUST produce a discuss turn.
- **FR-015**: An issue with a linked open pull request MUST produce a build turn when the pull request has at least one new message, or when the issue has at least one new message.
- **FR-016**: On the pull request, new messages MUST be taken from top-level conversation comments and from unresolved inline review threads; a thread counts only when its newest comment is from an authorized account other than the agent.
- **FR-017**: An issue whose linked pull request is merged or closed MUST be treated as having no pull request.
- **FR-018**: An issue with new messages on both surfaces MUST produce exactly one build turn whose prompt includes the new messages from both.
- **FR-019**: An issue with no new messages on any surface MUST produce no work item.

**Claiming an issue and the working marker**

- **FR-020**: Before invoking the model for a work item, `do-work` MUST assign the issue to `agentUser` when the agent is not already among its assignees; the call MUST be additive (no existing assignee is removed), MUST be skipped when the agent is already assigned, and a failure MUST warn and let the turn proceed.
- **FR-021**: Before invoking the model for an item, `do-work` MUST post a "working" marker comment as the agent account on the surface that turn answers and MUST retain that comment's identifier and creation timestamp; if the marker cannot be posted, the item MUST be skipped without invoking the model.
- **FR-022**: After the model run finishes — whether it succeeded or failed — `do-work` MUST re-read the answering surface and determine whether the agent posted a message that is newer than the marker and distinct from it. On a pull request, an agent reply inside a review thread MUST count as such a message.
- **FR-023**: When such an answer exists, `do-work` MUST delete the marker comment. It MUST NOT delete the marker in any other circumstance, and MUST confirm the answer exists before deleting.
- **FR-024**: When no such answer exists, `do-work` MUST update the marker comment in place — never delete it — with text reporting what happened: that the run finished or failed, and that no answer was produced. The update MUST NOT change the comment's creation timestamp, so the boundary still holds and the run is not retried automatically.

**Execution**

- **FR-025**: Work items MUST be processed sequentially, one model run per item, and a failing item MUST NOT abort the remaining items.
- **FR-026**: Marker reconciliation MUST run for every item whose model was invoked, including one whose run threw, before the tick moves to the next item; a failure to delete or update the marker MUST warn without changing the item's outcome.
- **FR-027**: Before a discuss turn, `do-work` MUST place the working tree on the configured base branch, up to date with the remote.
- **FR-028**: Before a build turn, `do-work` MUST check out the pull request's head branch and bring it up to date with the remote.
- **FR-029**: `do-work` MUST skip an item, with a warning, when the working tree has uncommitted changes or the required branch cannot be prepared, and MUST NOT stash, reset or discard anything.
- **FR-030**: `do-work` MUST honour `--max-runs` and the configured per-tick cap, reporting the remaining items as deferred.
- **FR-031**: `do-work` MUST hold an exclusive per-repository automata run lock for the duration of a tick, MUST exit 0 without doing any work when the lock is held by a live process, MUST reclaim a stale lock, and MUST release the lock on success, failure and interruption.
- **FR-032**: The lock MUST be acquired before any GitHub call that could change state, so that a contending instance neither assigns, posts, nor invokes a model.

**Prompt composition**

- **FR-033**: The turn instructions MUST come from the prompt configured for that turn kind, resolved with the same `.md` file-reference rules as the existing prompts, with a built-in default used when none is configured.
- **FR-034**: `do-work` MUST append to the configured prompt a context block containing: the repository, the turn kind, the issue number, title and URL, the pull request number, URL and head branch when one exists, the new messages marked as new, the full filtered conversation oldest first, and the unresolved review threads with file and line when present.
- **FR-035**: The built-in default prompts MUST state the turn boundary explicitly — a discuss turn must not modify files and must answer on the issue, unless a new message asks for implementation, in which case it must create a branch and a pull request whose body closes the issue; a build turn must work on the named branch, commit, push, answer on the pull request, and never merge it or push to the base branch — and MUST NOT name any skill, so that `do-work` works with no plugin installed.

**Link repair**

- **FR-036**: After a discuss turn, `do-work` MUST check whether the current branch now has a pull request and, if that pull request has no closing reference to the issue, MUST add one; if it already has one, the body MUST be left untouched.

**Reporting**

- **FR-037**: `do-work` MUST print a work plan before execution listing, per issue, the detected turn kind (or "nothing to do") and the reason.
- **FR-038**: With `--json`, `do-work` MUST emit the work plan and per-item outcomes as JSON on stdout, keeping human-readable progress on stderr.
- **FR-039**: With `--dry-run`, `do-work` MUST print the work plan and stop: no assignment, no marker comment posted, edited or deleted, no branch change, no executor, no link repair.
- **FR-040**: `do-work` MUST print an end-of-tick summary with one line per item and its outcome.

**Configuration**

- **FR-041**: A `doWork` configuration section MUST hold the base branch, the default executor and model, the per-tick run cap, the lock staleness window and the per-turn prompts, with documented defaults for every field.
- **FR-042**: Command-line options MUST take precedence over the `doWork` configuration section.
- **FR-043**: The `doWork` settings MUST be reachable both from the interactive wizard and from non-interactive `automata config set` subcommands.

**Documentation**

- **FR-044**: `docs/do-work.md` MUST be the authoritative command reference: synopsis, options, detection rules, turn kinds, configuration, lock behaviour and exit codes, consistent with the existing `docs/<group>.md` pages.
- **FR-045**: A wiki MUST be authored under `docs/wiki/` explaining the process, with an index page and pages covering: concepts and actors; the end-to-end lifecycle of an issue; the detection rules and turn decision table; environment setup and the cron entry; the prompt contract; day-to-day operation and safety boundaries; troubleshooting; and what is deliberately deferred.
- **FR-046**: The wiki MUST state that `do-work` invokes the executor with permission prompts bypassed and MUST therefore run in an isolated, disposable environment, and MUST list what the harness never does (no merge, no issue closure, no push to the base branch, no action on unauthorized messages).
- **FR-047**: The wiki MUST document the prompt contract: what automata assembles, what the configured prompt is responsible for, and that naming a skill is the prompt's job — including a worked example of a prompt that names one.
- **FR-048**: `README.md` MUST gain a short `automata do-work` section linking to `docs/do-work.md` and to the wiki index, keeping the README small per the documentation convention.

### Key Entities

- **WorkSurface**: an issue or a pull request; carries an ordered list of messages, each with author, timestamp, body and kind.
- **Message**: one issue comment, PR conversation comment, review body, or comment inside a review thread; classified as authorized, agent, or ignored, and flagged new or not.
- **IssueState**: a discovered issue, its filtered conversation, its assignees, and its linked open pull request with that pull request's filtered conversation and unresolved threads.
- **WorkItem**: one issue plus the decided turn kind (`issue-discuss` or `pr-work`), the new messages that justified it, and the branch the turn must run on.
- **Marker**: the transient "working" comment `do-work` posts before a run, identified by comment id and creation timestamp; deleted when the model produced an answer, updated in place when it did not.
- **TickReport**: the work plan plus per-item outcome (`answered`, `answered-no-reply`, `skipped`, `failed`, `deferred`) and the resulting exit code.

## Success Criteria *(mandatory)*

- **SC-001**: A tick over a repository with no pending work makes no model call, assigns nothing, posts nothing, and exits 0.
- **SC-002**: An issue conversation between authorized humans and the agent alternates without duplicate agent answers: after the agent answers, the next tick finds no work until an authorized account speaks again.
- **SC-003**: A completed conversation contains no leftover "working" markers — only the humans' messages and the agent's real answers — while every run that produced no answer has left exactly one marker saying so.
- **SC-004**: A comment from an unauthorized account never triggers a model run and never appears in a prompt.
- **SC-005**: An issue can be carried from first description to a merged-ready pull request using only `do-work` ticks plus authorized human messages, with no other automata command run by hand.
- **SC-006**: Every issue the agent has worked on is visibly assigned to the agent identity in the GitHub UI.
- **SC-007**: While one automata instance is running in a repository, a second instance started by cron does no work and exits quietly.
- **SC-008**: `--dry-run` output is sufficient to predict exactly which turns a real tick would run.
- **SC-009**: Agent behaviour can be changed by editing a prompt in `.automata/` with no CLI release, and `do-work` runs correctly with no skills or plugins installed.
- **SC-010**: `npm test && npm run lint` pass, and `do-work`'s own detection logic is covered by unit tests that need no `gh` binary.
- **SC-011**: A reader new to the repository can configure the harness and predict a tick's turns from the wiki alone, without reading the source.
- **SC-012**: The feature is dogfooded: at least one issue in this repository is carried through a real `do-work` tick.
