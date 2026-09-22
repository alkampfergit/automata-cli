# Data Model: Blocked-exit diagnostics

Every entity here is a value type. Nothing is persisted except the run lock (one added field) and the
heartbeat sidecar (new, transient).

## `BlockedReason` (`src/commands/doWork.ts`)

```ts
type BlockedReason =
  | "lock-held"        // acquireRunLock returned { ok: false }
  | "config-invalid"   // resolveSettingsResult returned { ok: false }
  | "preflight-failed" // the pre-flight degraded and no item reached the executor
  | "no-candidates"    // the selection produced zero work items
  | "all-skipped";     // work items existed; none reached the executor
```

Ordered by precedence: the first that applies is the one reported. `preflight-failed` outranks
`no-candidates` and `all-skipped` because it is the cause of them when it is present.

Each reason carries a **trigger**: one sentence in the operator's words, interpolated with the identifying
facts available — `run lock held by pid 851554 on cisharpai`, `no candidate was picked up (0 of 8)`.

## `Heartbeat` (`src/run/heartbeat.ts`)

```ts
interface HeartbeatItem { index: number; total: number; subject: string }
interface HeartbeatExecutor { command: string; startedAt: string }

interface Heartbeat {
  /** The run lock token this belongs to. A mismatch means a previous holder wrote it. */
  token: string;
  /** ISO-8601. */
  updatedAt: string;
  phase: HeartbeatPhase;
  item: HeartbeatItem | null;
  executor: HeartbeatExecutor | null;
}

type HeartbeatPhase = "pre-flight" | "discovery" | "item" | "summary";
```

Stored at `.automata/automata-heartbeat.json`, next to the lock. Written whole on every update — it is
small, and a partial-write window matters less than never blocking on it. Deleted on release, best-effort;
a leftover is harmless because the token will not match the next holder's.

## `TracedCommand` (`src/run/commandTrace.ts`)

```ts
interface TracedCommand {
  command: string;   // "git" | "gh" | an absolute path when resolved
  args: string[];
  durationMs: number;
  exitCode: number;
}
```

Collected into a module-level sink that is `null` unless `startCommandTrace()` has been called.

## Extensions to existing types

### `LockOwner` (`src/run/runLock.ts`)

```ts
/** The holder's working directory. Absent in a lock written before 0.8.x. */
cwd?: string;
```

### `LockStatus` (`src/run/runLock.ts`)

The `held` and `suspect` variants gain `heartbeat: Heartbeat | null` — null when absent, unreadable, or
belonging to a different token.

### `Problem` (`src/run/checkReport.ts`)

```ts
/** One command that investigates this further; null when no single command does. */
command: string | null;
```

### `CheckReport` (`src/run/checkReport.ts`)

```ts
/** The --verbose command trace; null when tracing was off. */
trace: TracedCommand[] | null;
```

### `LogDirectoryStatus` (`src/run/operationLog.ts`)

```ts
interface LogDirectoryStatus {
  dir: string;       // operationLogDirectory()
  cwd: string;       // the directory it was derived from
  writable: boolean;
  /** The failure when `writable` is false; null otherwise. */
  detail: string | null;
}
```

### `AutomataDoWorkConfig` (`src/config/configStore.ts`)

```ts
/** Render the health report on a blocked exit. Default true. */
dumpOnBlock?: boolean;
```
