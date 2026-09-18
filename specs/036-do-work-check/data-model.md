# Phase 1 Data Model: `do-work --check`

No persistent data. Every entity below is an in-memory value produced during one
invocation and discarded when the process exits (FR-020: the check records nothing).

## `CheckReport`

The whole diagnostic.

| Field | Type | Meaning |
|---|---|---|
| `generatedAt` | `Date` | When the report was produced. |
| `repo` | `string \| null` | `owner/name`, or null when the slug could not be resolved. |
| `offline` | `boolean` | True when `--no-fetch` suppressed every network call. |
| `sections` | `CheckSection[]` | The six sections, in report order. |
| `problems` | `Problem[]` | Flattened, in section order. Empty means healthy. |
| `exitCode` | `0 \| 1` | `problems.length === 0 ? 0 : 1`. |

## `CheckSection`

| Field | Type | Meaning |
|---|---|---|
| `id` | `"lock" \| "ticks" \| "work" \| "git" \| "selection" \| "environment"` | Stable key; the `--json` document is keyed by it. |
| `title` | `string` | Heading in the text report. |
| `lines` | `string[]` | The section's findings, already in the operator's words. |
| `problems` | `Problem[]` | This section's problems; a subset of `lines` by meaning, never by identity. |
| `data` | `Record<string, unknown>` | The structured form of the same facts, for `--json`. |

A section that could not be collected reports one line naming the failure and one problem;
it never throws (FR-014).

## `Problem`

| Field | Type | Meaning |
|---|---|---|
| `section` | `CheckSection["id"]` | Where it was found. |
| `summary` | `string` | One line, in the operator's words, stating what is wrong and — where there is one — what fixes it. |

## `LockStatus` (`src/run/runLock.ts`)

Discriminated union. Produced by `inspectRunLock(staleMinutes)`.

| Variant | Fields | Meaning |
|---|---|---|
| `{ kind: "free" }` | — | No lock file. No tick is running here. |
| `{ kind: "held"; owner: LockOwner; heldForMs: number }` | | A live, in-window lock. Not a problem. |
| `{ kind: "suspect"; owner: LockOwner; heldForMs: number }` | | Live on this host but past `lockStaleMinutes` with an unverifiable identity. Problem. |
| `{ kind: "stale"; owner: LockOwner \| null; heldForMs: number \| null }` | | Dead pid, pid reused, or unparseable. The next tick reclaims it. Problem. |
| `{ kind: "unreadable"; detail: string }` | | The path exists but could not be read. Problem. |

`LockOwner` is the existing interface: `pid`, `startedAt`, `host`, `command`, `token`,
`pidStartedAt?`.

## `ExecutionTick` (`src/run/operationLog.ts`)

One parsed line of `automata-execution.log`.

| Field | Type |
|---|---|
| `timestamp` | `Date` |
| `command` | `string` |
| `repo` | `string \| null` (`-` parses to null) |
| `items` | `number` |
| `counts` | `Record<OperationOutcome, number>` |
| `runs` | `number` |
| `exitCode` | `number` |
| `durationSeconds` | `number` |
| `note` | `string \| null` |

`readExecutionTicks({ repo, limit })` returns
`LogReadResult<ExecutionTick> = { entries, present, error, skipped, otherRepos, filtered, path }`
— `entries` newest first, `skipped` counting unparseable lines, `otherRepos` counting lines
belonging to a different slug, and `filtered` false when no slug was given and the entries
therefore come from every checkout sharing the log.

## `WorkRecord` (`src/run/operationLog.ts`)

One `=== <iso> <slug> ===` block of `automata-work.log`.

| Field | Type |
|---|---|
| `timestamp` | `Date` |
| `repo` | `string \| null` |
| `items` | `WorkRecordItem[]` |

`WorkRecordItem`: `subject`, `turn: string \| null`, `outcome`, `executor: string \| null`,
`model: string \| null`, `effort: string \| null`, `sync: string \| null`, `detail`.

`readWorkRecords({ repo, limit })` returns `LogReadResult<WorkRecord>` — the same envelope,
with the records in `entries`, newest first.

## `TickCadence` (`src/run/checkReport.ts`)

The scheduler-silence judgement (R3).

| Field | Type | Meaning |
|---|---|---|
| `medianIntervalMs` | `number \| null` | Null when fewer than three intervals are available. |
| `sinceNewestMs` | `number \| null` | Null when there are no ticks. |
| `silent` | `boolean` | `medianIntervalMs !== null && sinceNewestMs > 3 × medianIntervalMs`. |

## `RepoStatus` (`src/git/repoStatus.ts`)

| Field | Type | Meaning |
|---|---|---|
| `branch` | `string \| null` | Current branch; null when HEAD is detached. |
| `head` | `string \| null` | Short sha of HEAD. |
| `dirtyPaths` | `string[]` | Porcelain entries, excluding the run lock's own path. |
| `statusError` | `string \| null` | Set when `git status` itself failed, so `dirtyPaths` says nothing. |
| `baseBranch` | `string` | The configured base branch, echoed for the report. |
| `baseLocal` | `boolean` | Does `refs/heads/<base>` exist? |
| `upstream` | `string \| null` | The base branch's upstream ref, e.g. `origin/develop`. |
| `upstreamTracked` | `boolean` | True only when `<base>@{u}` resolved; false means `upstream` was inferred from `refs/remotes/origin/<base>`, which the pre-flight's bare `git pull --ff-only` cannot use. |
| `ahead` / `behind` | `number \| null` | Base branch against its upstream; null when either side is missing. |
| `refreshed` | `boolean` | Whether the remote-tracking ref was fetched this run. |
| `fetchError` | `string \| null` | The fetch's stderr when it failed. |

## `SelectionOutcome` (in `doWork.ts`)

| Variant | Meaning |
|---|---|
| `{ kind: "skipped-offline" }` | `--no-fetch` was given. No problem. |
| `{ kind: "failed"; detail: string }` | A `gh` call threw. Problem. |
| `{ kind: "collected"; decisions: Decision[] }` | The real `Decision[]` a tick would compute. |

`Decision` is the existing union from `src/github/workDetection.ts`; no new shape is
introduced, which is what makes the check's answer the tick's answer.
