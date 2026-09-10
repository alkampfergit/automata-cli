# Data Model: Claim an unassigned issue and pull request for the agent

No persisted data changes. The feature adds one fetched field and two derived
booleans, all in memory for the duration of a tick.

## Fetched state

| Entity | Field | Change | Source |
|---|---|---|---|
| `IssueSurface` | `assignees: string[]` | unchanged (already fetched and normalised) | `gh issue view --json …,assignees` |
| `PrSurface` | `assignees: string[]` | **new** | `gh pr view --json …,assignees`, flattened through the existing `login()` helper |
| `getCurrentBranchPr()` result | `assignees: string[]` | **new** | `gh pr view --json number,url,body,assignees` |

`assignees` is always a normalised array of login strings, lower/upper case as GitHub
reports it, with empty logins filtered out — the same treatment `IssueSurface.assignees`
already receives. An absent field is normalised to `[]`.

## Derived decision (pure, in `decideWork`)

| Field on `WorkItem` | Type | Rule | When false |
|---|---|---|---|
| `needsAssignment` | `boolean` | `issueSurface.assignees.length === 0` | any assignee present, agent or not |
| `prNeedsAssignment` | `boolean` | build turn **and** `prSurface.assignees.length === 0` | discuss turn (no pull request yet), or the pull request has any assignee |

`prNeedsAssignment` is `false` for every `issue-discuss` item by construction: no pull
request is known at decision time, so that surface is claimed later from
`getCurrentBranchPr()`.

## Removed

- `isAssignedToAgent(assignees, agentUser)` — membership is no longer part of the rule.

## Invariants

1. A claim is attempted only when the corresponding boolean is `true`.
2. A claim never removes or replaces an assignee — the underlying call is
   `--add-assignee`, and it is skipped entirely on a non-empty list.
3. A claim failure never propagates: it is caught, warned, and the turn continues.
4. `--dry-run` reads both booleans and writes nothing.
