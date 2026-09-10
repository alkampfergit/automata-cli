# Data Model: Manage orphaned pull requests in `do-work`

**Branch**: `feature/033-orphan-pull-requests` | **Date**: 2026-09-10

No persistent data is added. The "model" here is the in-memory shapes that cross module boundaries,
plus the two externally observable contracts (`.automata/config.json` and the `--json` payload).

## New types

### `OrphanPr` — `src/github/ghWorkService.ts`

An open pull request of this repository that declares no closing reference to an issue of this
repository, carried together with the two fields the discovery filter needs.

```ts
export interface OrphanPr {
  pr: PullRequestRef;
  /** Label names, as returned by the pull-request query. */
  labels: string[];
  /** Assignee logins. */
  assignees: string[];
}
```

`labels` and `assignees` live here rather than on `PullRequestRef` because only discovery reads
them — see `research.md`.

### `OrphanPrState` — `src/github/workDetection.ts`

Everything the orphan decision needs. Deliberately smaller than `IssueState`: there is no issue
surface and no link set to resolve.

```ts
export interface OrphanPrState {
  prSurface: PrSurface;
}
```

## Changed types

### `TurnKind` — `src/config/configStore.ts`

```ts
export type TurnKind = "issue-discuss" | "pr-work" | "pr-orphan";
```

### `DoWorkPrompts` — `src/config/configStore.ts`

```ts
export interface DoWorkPrompts {
  issueDiscuss?: string;
  prWork?: string;
  prOrphan?: string;   // new
}
```

Resolved through `resolvePromptRef` in `readConfig` exactly as its two siblings are, so
`"prOrphan": "do-work-pr-orphan.md"` reads the file from `.automata/`. An unresolvable value stays
fatal for `do-work` rather than falling back to the default.

### `OpenPrLinkMap` — `src/github/ghWorkService.ts`

```ts
export interface OpenPrLinkMap {
  byIssue: Map<number, PullRequestRef[]>;
  defaultBranch: string | null;
  orphans: OrphanPr[];   // new — open PRs closing no issue of this repository
}
```

Filled from the same paged query, which gains `labels(first:50){nodes{name}}` and
`assignees(first:50){nodes{login}}` in its selection set. `orphans` is ordered as GitHub returns the
pages: most recently updated first.

### `WorkItem` — `src/github/workDetection.ts`

```ts
export interface WorkItem {
  /** null only when turn === "pr-orphan": there is no issue. */
  issue: GitHubIssue | null;
  turn: TurnKind;
  pr: PullRequestRef | null;         // non-null for pr-work and pr-orphan
  branch: string;
  needsAssignment: boolean;          // always false for pr-orphan
  issueAnalysis: SurfaceAnalysis;    // the empty analysis for pr-orphan
  prAnalysis: SurfaceAnalysis | null;
  actionableThreads: ReviewThread[];
  reason: string;
  ambiguousPrs: PullRequestRef[];    // always empty for pr-orphan
}
```

### `Decision` and `SkipReason` — `src/github/workDetection.ts`

```ts
export type SkipReason =
  | "issue-closed"
  | "no-new-messages"
  | "unsafe-pr-branch"
  | "pr-closed"    // new: the pull request was closed or merged
  | "pr-linked";   // new: it gained a closing reference, so the issue pass owns it

export type Decision =
  | { kind: "work"; item: WorkItem }
  | {
      kind: "skip";
      issue: GitHubIssue | null;
      pr: PullRequestRef | null;   // new: what to name when there is no issue
      reason: SkipReason;
      detail: string;
    };
```

### `ItemReport` — `src/commands/doWork.ts`

```ts
interface ItemReport {
  issue: number | null;   // null for a pr-orphan item
  pr: number | null;      // new
  title: string;          // the pull request title for a pr-orphan item
  turn: TurnKind | null;
  outcome: Outcome;
  detail: string;
  ranExecutor?: boolean;
  execution?: ResolvedExecution;
}
```

## Configuration contract

```json
{
  "doWork": {
    "prompts": {
      "issueDiscuss": "do-work-issue-discuss.md",
      "prWork": "do-work-pr-work.md",
      "prOrphan": "do-work-pr-orphan.md"
    }
  }
}
```

Validation (`validateDoWorkConfig` in `src/commands/doWork.ts`) accepts exactly
`issueDiscuss`, `prWork`, `prOrphan` under `doWork.prompts` and rejects anything else by name, as it
does today.

## `--json` contract

`items[]` on a real tick, and `plan[]` on both a real tick and a dry run, gain a `pr` field; `issue`
becomes nullable.

```jsonc
{
  "dryRun": false,
  "plan": [
    { "issue": 42, "pr": 57, "title": "…", "turn": "pr-work", "branch": "feature/042",
      "needsAssignment": false, "reason": "1 new pull request message on pull request #57" },
    { "issue": null, "pr": 61, "title": "Bump lodash", "turn": "pr-orphan", "branch": "dependabot/npm/lodash-4.17.21",
      "needsAssignment": false, "reason": "1 new pull request message on pull request #61" },
    { "issue": null, "pr": 62, "title": "Release 1.2.0", "turn": null,
      "skipReason": "unsafe-pr-branch", "reason": "pull request #62 has a protected branch (main) as its head, …" }
  ],
  "items": [
    { "issue": 42,   "pr": 57, "title": "…",          "turn": "pr-work",   "outcome": "answered", "detail": "answered", "ranExecutor": true,  "executor": "claude", "model": null, "effort": null, "executorSource": "default", "modelSource": "default", "effortSource": "default" },
    { "issue": null, "pr": 61, "title": "Bump lodash", "turn": "pr-orphan", "outcome": "deferred", "detail": "run cap of 1 reached", "ranExecutor": false, "executor": null, "model": null, "effort": null, "executorSource": null, "modelSource": null, "effortSource": null }
  ],
  "exitCode": 2
}
```

A `--dry-run`'s `runs[]` entries gain `pr` alongside the existing `issue`, for the same reason.

## Invariants

1. `item.issue === null` **iff** `item.turn === "pr-orphan"`.
2. `item.pr !== null` when `item.turn` is `"pr-work"` or `"pr-orphan"`.
3. A pull request appears in `OpenPrLinkMap.orphans` **iff** it appears in no `byIssue` entry — the
   two passes are disjoint by construction.
4. `item.needsAssignment === false` and `item.ambiguousPrs.length === 0` for every `pr-orphan` item.
