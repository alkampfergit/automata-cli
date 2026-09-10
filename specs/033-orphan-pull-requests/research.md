# Phase 0 Research: Manage orphaned pull requests in `do-work`

**Branch**: `feature/033-orphan-pull-requests` | **Date**: 2026-09-10

## What already exists

| Concern | Where it lives today | Reusable as-is? |
|---|---|---|
| Open pull requests, paged with their closing references | `LINK_MAP_QUERY` + `getOpenPrLinkMap` (`src/github/ghWorkService.ts:264`) | Yes — the query already reads every open pull request. Only `labels` and `assignees` are missing from the selection set. |
| A pull request's conversation and review threads | `getPrSurface` / `getReviewThreads` (`ghWorkService.ts`) | Yes, unchanged. |
| "Does this surface owe an answer?" | `analyzeSurface` / `lastAuthorClass` (`src/github/conversation.ts`) | Yes, unchanged — it is already issue-agnostic. |
| Fork and protected-branch refusal | `unsafeBranchSkip` (`src/github/workDetection.ts:150`) | Yes, once its `issue` parameter is allowed to be `null`. |
| Marker post / reconcile / overtaken-message report | `postMarker`, `analyseAnswer`, `promptWatermark` | Yes — `postMarker` already takes an `"issue" \| "pr"` surface and GitHub treats a pull request as an issue for comments. |
| Branch preparation for a head branch | `preparePrBranch` (`src/git/workspaceService.ts:57`) | Yes, unchanged. |
| Per-item executor/model directive | `triggeringMessage` / `resolveExecution` (`src/github/runDirective.ts`) | Yes — `triggeringMessage` branches on `turn === "issue-discuss"`, so a `pr-orphan` turn takes the pull-request path already. |
| Configurable prompt, four-point pattern | `DoWorkPrompts`, `resolvePromptRef`, `config set do-work-prompt`, wizard screen | Yes — the pattern is followed, not changed. |

The gap is therefore narrow: discovery of the candidates, a decision function for them, and a
work-item shape that has a pull request but no issue.

## Decisions

### Decision: `WorkItem.issue` becomes `GitHubIssue | null` rather than introducing a second item type

**Rationale**: `processItem` is ~110 lines of ordering-critical marker/boundary logic with six early
returns, and every one of its steps (branch preparation, marker, reconciliation, overtaken-message
report, oversized-prompt refusal, invalid-`tool:` refusal, run-cap accounting) applies unchanged to
an orphan pull request. A parallel `processOrphanItem` would duplicate all of it, which the
constitution's "shared logic MUST be extracted into service modules rather than duplicated" forbids
— and duplicating *this* function specifically means two copies of the answer-boundary argument that
governs whether a human message can be answered twice or lost.

**Alternatives considered**:
- A separate `OrphanWorkItem` type plus a second processing pipeline. Rejected: duplication of the
  safety-critical path.
- Synthesising a fake `GitHubIssue` for the pull request (`{ number: prNumber, … }`). Rejected: it
  would make `claimIssue`, `notePickupOnIssue` and `repairIssueLink` act on issue number 61 — a real,
  unrelated issue.
- A generic `subject: { kind: "issue" | "pr"; … }` discriminated union. Rejected as the indirection
  the constitution's Simplicity principle warns about: three of the four call sites only need
  "is there an issue?", which `issue !== null` answers.

### Decision: `issueAnalysis` stays a `SurfaceAnalysis` and holds the empty analysis for an orphan turn

**Rationale**: An orphan pull request has no issue surface, so "no issue messages, no new issue
messages, the agent never spoke there" is the *accurate* analysis, not a placeholder. Keeping the
field non-nullable avoids five `?? []` guards in `composePrompt`, `promptWatermark`,
`triggeringMessage` and `notePickupOnIssue`, each of which would be a place a future change could
get wrong.

**Alternatives considered**: `issueAnalysis: SurfaceAnalysis | null`. Rejected: more optional
plumbing for no added information.

### Decision: orphan candidates carry their labels and assignees in a new `OrphanPr` wrapper, not on `PullRequestRef`

**Rationale**: `PullRequestRef` is constructed in two places in `src/` and in five test fixtures.
Adding two required fields would either force `getPrSurface` to fetch data it does not need or
produce a `PullRequestRef` whose `labels` is silently empty depending on which call produced it —
the kind of "two shapes for one type" the file's own comments warn against. A wrapper
(`{ pr, labels, assignees }`) exists only where the filter is applied, which is discovery.

**Alternatives considered**:
- Adding `labels`/`assignees` to `PullRequestRef` and populating them in both producers. Rejected:
  `getPrSurface`'s consumers never read them, so it is data fetched to satisfy a type.
- Fetching a candidate's labels with a second `gh pr view` per pull request. Rejected: the link-map
  query already returns them for free in the same paged request, which is what makes SC-003
  ("no additional API calls when nothing matches") achievable.

### Decision: `--pr N` is resolved out of the link map, with no extra API call

**Rationale**: `getOpenPrLinkMap` reads *every* open pull request exhaustively — a partial read fails
the tick. So the map is authoritative about whether pull request N is open and whether it closes an
issue of this repository. `--pr N` therefore needs no fetch of its own: absent from the orphan list
and absent from the map ⇒ not an open pull request; absent from the orphan list but present in the
map ⇒ it belongs to an issue, so name that issue and point at `--issue`.

**Alternatives considered**: mirroring `discoverIssues`, which falls back to `getIssueSurface` when
the target is beyond `--limit`. Rejected: that fallback exists precisely because the *issue* list is
truncated by `--limit`; the pull-request map is not truncated at all, so the fallback would be
answering a question that cannot arise.

### Decision: the "no longer an orphan" check lives in the pre-run refresh, as a skip

**Rationale**: `processItem` already re-fetches the link map before every item, for the symmetric
reason on the issue side (a pull request opened mid-tick must switch the turn instead of starting a
competing implementation). The same re-fetch answers "did this pull request gain a closing reference
while an earlier item ran?" for free, and the honest outcome is a skip: the pull request now belongs
to the issue pass, whose prompt is the correct one for it.

**Alternatives considered**: running it anyway with the orphan prompt. Rejected: the maintainer's
edit is an explicit statement about which pass owns the pull request.

### Decision: two new skip reasons, `pr-closed` and `pr-linked`

**Rationale**: `SkipReason` is what the plan and `--json` report, and an operator reading
`no-new-messages` for a pull request that was merged mid-tick would be misinformed. The existing
reasons stay untouched, so no current consumer changes meaning.

**Alternatives considered**: reusing `issue-closed` for a closed pull request. Rejected: it names
the wrong object.

### Decision: `pr` is added to every `--json` item entry, not only to orphan entries

**Rationale**: `issue: null` alone leaves an orphan entry unidentifiable, and a field that is
present on some array elements and absent on others is harder to consume than one that is always
present and sometimes `null` — the same reasoning the existing code already applies to
`executor`/`model`, which are emitted unconditionally as `null` rather than omitted.

**Alternatives considered**: an `orphanPr` field only on orphan entries. Rejected for the reason
above.

**Known consequence**: `tests/unit/doWork.cmd.test.ts`'s "--json reports per-item outcomes"
compares a whole item object with `toEqual`, so it must be updated. This is recorded in the PR report
as a nominally breaking change to the `--json` shape (project memory notes this exact test).

### Decision: no assignment, no pickup note and no link repair on a `pr-orphan` turn

**Rationale**: all three are issue mechanisms. Assignment exists to make the claim visible in the
*issue* list; the pickup note exists because a build turn triggered by *issue* messages answers
somewhere else; link repair exists to maintain the issue↔pull-request state machine. An orphan turn
has one surface and no issue, so the `working…` marker on the pull request is the whole claim.
Additionally, with `issueDiscoveryTechnique: assignee`, assigning the agent to the pull request
would change what the discovery filter matches on the next tick.

**Alternatives considered**: `gh pr edit --add-assignee` for visibility. Rejected as scope not asked
for, and actively wrong under an `assignee` discovery filter.

### Decision: the default `prOrphan` prompt does not ask the model to merge or close

**Rationale**: `docs/do-work.md` documents "What `do-work` never does: merge a pull request, close an
issue". A default prompt telling the model to merge would contradict the command's own contract. The
default asks it to inspect CI, rebase or fix the branch if needed, push, and **recommend** merge or
close in its reply.

**Alternatives considered**: a prompt that closes a superseded Dependabot pull request. Rejected: it
is a policy decision that belongs to the repository's own `prOrphan` prompt, which is configurable
precisely so a maintainer can opt into it.

## Autonomous Decisions

Every `[AUTO]` entry in `spec.md`'s Assumptions and Clarifications sections was resolved without
user input, using the rules above plus `.specify/memory/speckit-memory.md`. The two that most shape
the implementation are repeated here for the reviewer:

- **Trigger rule**: unanswered authorized message only. Decided by the maintainer in issue #59, and
  it is also what keeps one idempotence argument for all three turn kinds.
- **Discovery filter reuse**: the same `issueDiscoveryTechnique` / `issueDiscoveryValue` applied to
  the pull request, so no new configuration key exists for selecting orphan pull requests.
