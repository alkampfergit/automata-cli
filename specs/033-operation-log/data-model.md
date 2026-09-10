# Data Model: Operation log for `do-work`

**Feature**: `feature/033-operation-log` | **Date**: 2026-09-10

No persistent structured store. Two append-only plain-text files, plus the
in-memory types that produce them.

## In-memory types (`src/run/operationLog.ts`)

```ts
export type OperationOutcome =
  | "answered"
  | "answered-no-reply"
  | "skipped"
  | "failed"
  | "deferred";

export interface TickLogItem {
  issue: number;
  turn: string | null;
  outcome: OperationOutcome;
  detail: string;
  /** Whether the executor was actually invoked — decides work-log membership. */
  ranExecutor: boolean;
  executor?: string;
  model?: string;
  effort?: string;
}

export interface TickLog {
  command: string;
  /** `owner/name`, or null when the slug could not be resolved. */
  repo: string | null;
  timestamp: Date;
  durationMs: number;
  exitCode: number;
  /** A short marker for an invocation that did not run a tick, e.g. "lock-held". */
  note?: string;
  items: TickLogItem[];
}
```

`TickLogItem` is produced from `ItemReport` (`src/commands/doWork.ts:107`) by
`toTickLogItem`, flattening `execution` the same way `toItemJson` does for
`--json`.

## File: `automata-execution.log`

**Location**: `path.dirname(process.cwd())/automata-execution.log`

**Retention**: newest `MAX_EXECUTION_LINES = 1000` lines.

**Grammar** — one record per line, no header, fields space-separated:

```text
<iso-timestamp> <command> repo=<owner/name|-> items=<n> answered=<n> \
  answered-no-reply=<n> skipped=<n> failed=<n> deferred=<n> runs=<n> \
  exit=<n> dur=<seconds>s[ note=<token>]
```

(shown wrapped for readability; it is emitted as a single line)

| Field | Source | Notes |
|-------|--------|-------|
| timestamp | `TickLog.timestamp.toISOString()` | UTC, millisecond precision |
| command | `TickLog.command` | always `do-work` in this iteration |
| `repo` | `TickLog.repo` | `-` when the slug could not be resolved |
| `items` | `items.length` | reported items, including deferred and skipped |
| five outcome keys | count of `items` per `outcome` | always emitted, even at 0 |
| `runs` | count of `items` with `ranExecutor` | what `--max-runs` counts |
| `exit` | `TickLog.exitCode` | 0 healthy, 2 degraded, 1 error |
| `dur` | `durationMs / 1000`, one decimal | e.g. `42.1s` |
| `note` | `TickLog.note` | present only for `lock-held` |

**Example**:

```text
2026-09-10T06:51:36.412Z do-work repo=alkampfergit/automata-cli items=2 answered=1 answered-no-reply=0 skipped=0 failed=0 deferred=1 runs=1 exit=2 dur=42.1s
2026-09-10T06:56:03.008Z do-work repo=alkampfergit/automata-cli items=0 answered=0 answered-no-reply=0 skipped=0 failed=0 deferred=0 runs=0 exit=0 dur=1.8s
2026-09-10T07:01:02.771Z do-work repo=alkampfergit/automata-cli items=0 answered=0 answered-no-reply=0 skipped=0 failed=0 deferred=0 runs=0 exit=0 dur=0.3s note=lock-held
```

## File: `automata-work.log`

**Location**: `path.dirname(process.cwd())/automata-work.log`

**Retention**: records whose header timestamp is within
`WORK_RECORD_MAX_AGE_DAYS = 30` days of now.

**Grammar** — a record is a header line, one or more item lines, and a blank
separator line. A record starts at a line matching `^=== `.

```text
=== <iso-timestamp> <owner/name|-> ===
#<issue> <turn|-> <outcome>[ [<executor>[ model=<m>][ effort=<e>]]] — <detail>
<blank line>
```

- Only items with `ranExecutor === true` appear.
- `detail` is truncated to `MAX_DETAIL_LENGTH = 200` characters, with a
  trailing `…` when truncated, and any newline collapsed to a space so one item
  is always one line.
- Text before the first `=== ` header (a hand-written note, a partial write) is
  preserved verbatim by pruning.

**Example**:

```text
=== 2026-09-10T06:51:36.412Z alkampfergit/automata-cli ===
#53 issue-discuss answered [claude model=opus-5] — posted a reply
#51 pr-work answered [codex effort=high] — pushed 2 commits

=== 2026-09-10T07:34:11.902Z alkampfergit/automata-cli ===
#57 issue-discuss failed [claude] — the executor exited with status 1

```

## Retention functions

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `trimToLastLines` | `(content: string, max: number) => string` | Returns `content` unchanged when it holds `max` lines or fewer; otherwise the last `max` lines, newline-terminated. A trailing newline is not counted as a line. |
| `pruneOldRecords` | `(content: string, now: Date, maxAgeMs: number) => string` | Keeps the pre-header preamble, then keeps each `=== …` record whose parsed header timestamp is newer than `now - maxAgeMs`. A header whose timestamp does not parse keeps its record. |

Both are pure and total: they never throw and never return `undefined`.
