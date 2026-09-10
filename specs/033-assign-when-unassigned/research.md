# Phase 0 Research: Claim an unassigned issue and pull request for the agent

## What exists today

- `decideWork()` (`src/github/workDetection.ts:172`) computes
  `needsAssignment = !isAssignedToAgent(issueSurface.assignees, p.agentUser)`, so the
  agent is *added* to an issue a human already owns. That is exactly the behaviour
  issue #57 asks to change.
- `claimIssue()` (`src/commands/doWork.ts:571`) is already advisory: it calls
  `assignIssueToAgent()` inside a `try`/`catch` and downgrades a failure to a
  `warning:` progress line. It is invoked once per item, after branch preparation and
  before the `working…` marker (`doWork.ts:951`).
- `assignIssueToAgent()` (`src/github/ghWorkService.ts:560`) runs
  `gh issue edit <n> --add-assignee <login>` and throws on non-zero status.
- Nothing assigns anyone to a pull request. `PrSurface` does not carry `assignees`,
  and `getPrSurface()`'s `--json` list (`ghWorkService.ts:511`) does not request them.
- `getCurrentBranchPr()` (`src/config/githubService.ts:162`) requests
  `number,url,body`; it is the only place a pull request opened *during* a discuss
  turn is first seen (`repairIssueLink()`, `doWork.ts:855`, and `linkPrToIssue()`,
  `getReady.ts:210`).

## Decisions

### D1 — Where the "is it claimable?" decision lives

**Decision**: Both booleans are computed in `decideWork()` and carried on `WorkItem`:
`needsAssignment` (issue) becomes `issueSurface.assignees.length === 0`, and a new
`prNeedsAssignment` is `true` only for a build turn whose `PrSurface.assignees` is
empty.

**Rationale**: `decideWork()` is the deliberately I/O-free state machine of the loop,
and `needsAssignment` is already one of its outputs — so the new rule is a one-line
change in a module with an exhaustive unit suite, and the dry-run plan gets the answer
for free because it prints from the same `WorkItem`.

**Alternatives considered**: computing it inside `claimIssue`/`claimPr` at the call
site. Rejected: `--dry-run` prints the plan without calling those functions, so the
plan and the action would derive the same fact from two places — the failure mode
recorded in project memory ("a flag added anywhere else makes the printed command a
lie").

### D2 — How the pull request's assignees reach the decision

**Decision**: Add `assignees: string[]` to `PrSurface` (not to `PullRequestRef`), and
add `assignees` to the `gh pr view --json` field list in `getPrSurface()`.

**Rationale**: `PullRequestRef` is built in two places — `getPrSurface()` and the
GraphQL link-map query — so a field on it would have to be fetched in both, and the
link map paginates every open pull request in the repository to build the issue→PR
map. `PrSurface` is fetched only for the one selected pull request, which is precisely
the one that can be claimed. Zero extra `gh` calls and zero extra GraphQL cost.

**Alternatives considered**: a dedicated `getPrAssignees(prNumber)` call. Rejected: an
extra `gh` round trip per item for data the surface fetch can carry.

### D3 — Assigning a pull request through `gh`

**Decision**: New `assignPrToAgent(prNumber, agentUser)` in `ghWorkService.ts`,
running `gh pr edit <n> --add-assignee <login>`, mirroring `assignIssueToAgent`
including its throw-on-failure contract.

**Rationale**: Verified against the installed binary — `gh pr edit --help` documents
`--add-assignee login` (and `gh pr view --json` lists `assignees` as a valid field).
`gh issue edit` is not reused for a pull request: it issues the `updateIssue` GraphQL
mutation, which does not accept a pull request node, even though REST treats a pull
request as an issue.

**Alternatives considered**: a single `assignToAgent(surface, number, login)` taking
`"issue" | "pr"`. Rejected: it would be a two-line function switching on a discriminant
to pick one word of the argv, and the existing exported name is used in tests and
imports.

### D4 — Claiming a pull request that did not exist when the plan was built

**Decision**: Claim inside `repairIssueLink()` (`do-work`) and `linkPrToIssue()`
(`implement-next`), driven by an `assignees` field added to `getCurrentBranchPr()`'s
return type.

**Rationale**: These are the two functions that already resolve "the pull request the
model just opened" from the current branch, and both already run their steps
best-effort. `getCurrentBranchPr()` performs a `gh pr view` regardless, so adding one
field to its `--json` list costs nothing and avoids a second lookup.

**Alternatives considered**: re-running `getPrSurface()` after the executor. Rejected:
it fetches the whole conversation plus every review thread (a paginated GraphQL query)
to read one array.

### D5 — Reporting in the plan and in `--json`

**Decision**: The human-readable plan line and the per-item dry-run header report both
claims; `toPlanJson()` gains a `prNeedsAssignment` field alongside the existing
`needsAssignment`.

**Rationale**: FR-007. The operator auditing a tick needs to know which surfaces the
run will touch, and the pull-request claim is a new write that was not there before.

**Alternatives considered**: leaving `--json` unchanged to avoid breaking a consumer's
exact-match assertion. Rejected: the plan JSON is the machine-readable form of the
same plan, and a claim the text reports but the JSON hides is worse than a nominally
additive field. Recorded as a nominal breaking change in the PR report, as project
memory prescribes for `--json` payload additions.

### D6 — `implement-next`'s claimant when `agentUser` is unset

**Decision**: Use `config.agentUser` when it is a non-empty string; otherwise fall
back to the literal `@me`, which `gh pr edit --add-assignee` resolves to the
authenticated account.

**Rationale**: `agentUser` is mandatory for `do-work` (it refuses to run without one,
`doWork.ts:181`) but optional for `implement-next`, which is human-driven. The person
running the command *is* the identity doing the work, so `@me` is the correct claimant
and it needs no extra `gh api user` call. `@me` is documented in `gh pr edit --help`.

**Alternatives considered**: skipping the claim when `agentUser` is unset. Rejected:
it would make the feature invisible for every user who has not configured the loop.

### D7 — What `isAssignedToAgent()` becomes

**Decision**: Delete it.

**Rationale**: Its only caller is the claim decision, and under the new rule membership
is never tested — only emptiness. Leaving an unused case-insensitive login comparison
in a module that documents itself as the loop's state machine would invite a future
reader to reintroduce the old behaviour.

**Alternatives considered**: keeping it for the plan text ("already assigned to the
agent" vs "already assigned to somebody else"). Rejected: the rule deliberately does
not distinguish those cases, so the plan must not either.

## Autonomous Decisions

Every open question was resolved without user input; the substantive one (which
identity to assign, and the empty-list rule) was answered by the maintainer on issue
\#57 and is recorded in the spec's Clarifications section. The remainder are D1–D7
above, each with its rejected alternative.

## Verified externally

- `gh pr edit --help` → `--add-assignee login  Add assigned users by their login. Use
  "@me" to assign yourself…`
- `gh pr view --json` field list includes `assignees`.

Both checked against the `gh` binary installed in this environment rather than from
memory, per project memory's rule on external CLI flags.
