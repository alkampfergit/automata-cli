# Spec Decisions: Claim an unassigned issue and pull request for the agent

**Branch**: `feature/033-assign-when-unassigned`
**Date**: 2026-09-10
**Spec**: [specs/033-assign-when-unassigned/spec.md](../../specs/033-assign-when-unassigned/spec.md)
**Plan**: [specs/033-assign-when-unassigned/plan.md](../../specs/033-assign-when-unassigned/plan.md)
**Research**: [specs/033-assign-when-unassigned/research.md](../../specs/033-assign-when-unassigned/research.md)

## Planning Decisions

- **Where the claim decision lives**: both booleans are computed in the pure
  `decideWork()` state machine and carried on `WorkItem` (`needsAssignment` for the
  issue, the new `prNeedsAssignment` for the pull request). **Rationale**:
  `needsAssignment` is already one of its outputs, the module is I/O-free and has an
  exhaustive unit suite, and `--dry-run` prints from the same `WorkItem` so the plan
  and the action cannot disagree. **Alternatives considered**: deciding inside the
  advisory `claimIssue`/`claimPr` call sites — rejected because the dry run never
  calls them, so the printed plan would derive the same fact from a second place.

- **How the pull request's assignees are fetched**: `assignees` is added to
  `PrSurface` and to `getPrSurface()`'s `gh pr view --json` field list. **Rationale**:
  `PrSurface` is fetched only for the one selected pull request — exactly the one that
  can be claimed — so the data costs no extra `gh` call. **Alternatives considered**:
  putting it on `PullRequestRef` (built in two places, one of which paginates every
  open pull request in the repository) or a dedicated `getPrAssignees()` round trip.

- **Assigning a pull request through `gh`**: a new `assignPrToAgent()` runs
  `gh pr edit <n> --add-assignee <login>`, mirroring `assignIssueToAgent`.
  **Rationale**: verified against the installed binary; `gh issue edit` cannot be
  reused because its `updateIssue` GraphQL mutation does not accept a pull request
  node, even though REST models a pull request as an issue. **Alternatives
  considered**: one `assignToAgent(surface, …)` switching on a discriminant to choose
  one argv word.

- **Claiming a pull request that did not exist when the plan was built**: done inside
  `repairIssueLink()` (`do-work`) and `linkPrToIssue()` (`implement-next`), fed by an
  `assignees` field added to `getCurrentBranchPr()`. **Rationale**: these are the two
  functions that already resolve "the pull request the model just opened" and already
  run their steps best-effort; the `gh pr view` happens regardless, so one more
  `--json` field is free. **Alternatives considered**: re-running `getPrSurface()`
  after the executor — rejected, it re-fetches the whole conversation and every review
  thread to read one array.

- **Reporting**: the human-readable plan, the per-item dry-run header and
  `toPlanJson()` all report both claims. **Rationale**: the pull-request claim is a
  new write, and the dry run is the documented way to audit an unattended tick.
  **Alternatives considered**: leaving `--json` untouched to protect exact-match
  consumers — rejected; recorded instead as a nominal breaking change.

- **`implement-next`'s claimant**: `config.agentUser` when set, otherwise the literal
  `@me`. **Rationale**: `agentUser` is mandatory for `do-work` but optional for the
  human-driven `implement-next`, where the running identity is the correct claimant and
  `@me` needs no extra lookup. **Alternatives considered**: skipping the claim when
  `agentUser` is unset, which would hide the feature from everyone who has not
  configured the loop.

- **Removing `isAssignedToAgent()`**: deleted rather than kept. **Rationale**:
  membership is no longer part of the rule — only emptiness — and a leftover
  case-insensitive login comparison in the loop's state machine invites the old
  behaviour back. **Alternatives considered**: keeping it to distinguish "already
  assigned to the agent" from "assigned to someone else" in the plan text, which the
  rule deliberately does not distinguish.

- **Project structure**: no new module. **Rationale**: the whole rule is
  `assignees.length === 0`; the `gh` wrapper belongs beside `assignIssueToAgent` in
  `src/github/ghWorkService.ts`, which owns the private `spawnSync` runner.
  **Alternatives considered**: a `src/github/assignment.ts` module for one expression.
