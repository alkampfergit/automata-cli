import { unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What the tick holding the run lock is doing right now.
 *
 * The lock records who holds it and since when, which is enough to say "a tick
 * is running" and nothing more — so a loop that is slow and a loop that is
 * wedged look identical from outside. This file is the missing half: the phase,
 * the item in flight and the executor run under way.
 *
 * It is a *sidecar*, not extra fields on the lock, and that is the whole design.
 * `runLock.ts`'s mutual exclusion rests on `link`/`rename` atomicity over one
 * path; a read-modify-write of that path mid-tick could recreate a lock a
 * contender had just renamed away as stale, which is precisely the race
 * `acquireClaim` exists to close. A diagnostic must not be able to break the
 * thing it is diagnosing.
 *
 * Every entry carries the lock token it belongs to. A heartbeat whose token does
 * not match the lock currently held reads as absent — without that, a file left
 * behind by a holder that was killed would be presented as the live tick's
 * state, which is worse than saying nothing.
 *
 * Best-effort throughout, like `operationLog.ts`: no failure here may produce
 * output, a problem, or a change to any exit code.
 */

const HEARTBEAT_DIR = ".automata";
const HEARTBEAT_FILE = "automata-heartbeat.json";

/** The sidecar's path relative to the repository root, for documentation and messages. */
export const HEARTBEAT_RELATIVE_PATH = `${HEARTBEAT_DIR}/${HEARTBEAT_FILE}`;

/**
 * The stages a tick passes through, in order. Coarse on purpose: an operator
 * reading "discovery" for four minutes knows to look at GitHub, and a finer
 * breakdown would be a promise about internal structure that refactors break.
 */
export type HeartbeatPhase = "pre-flight" | "discovery" | "item" | "summary";

export interface HeartbeatItem {
  /** 1-based, so the rendered line reads "item 3 of 8". */
  index: number;
  total: number;
  /** `#82` / `PR #61`, rendered by the caller so it matches the tick's own output. */
  subject: string;
}

export interface HeartbeatExecutor {
  /** `claude` or `codex`, as the tick resolved it. */
  command: string;
  /** ISO-8601; the report turns it into "running for 2m". */
  startedAt: string;
}

export interface Heartbeat {
  /** The run lock token this belongs to. A mismatch means a previous holder wrote it. */
  token: string;
  updatedAt: string;
  phase: HeartbeatPhase;
  item: HeartbeatItem | null;
  executor: HeartbeatExecutor | null;
}

/** What a caller supplies; the token and the timestamp are added here. */
export interface HeartbeatUpdate {
  phase: HeartbeatPhase;
  item?: HeartbeatItem | null;
  executor?: HeartbeatExecutor | null;
}

const PHASES: readonly HeartbeatPhase[] = ["pre-flight", "discovery", "item", "summary"];

function isPhase(value: unknown): value is HeartbeatPhase {
  return typeof value === "string" && (PHASES as readonly string[]).includes(value);
}

export function heartbeatPath(cwd: string = process.cwd()): string {
  return join(cwd, HEARTBEAT_DIR, HEARTBEAT_FILE);
}

export function buildHeartbeat(
  token: string,
  update: HeartbeatUpdate,
  now: Date = new Date(),
): Heartbeat {
  return {
    token,
    updatedAt: now.toISOString(),
    phase: update.phase,
    item: update.item ?? null,
    executor: update.executor ?? null,
  };
}

export function formatHeartbeat(heartbeat: Heartbeat): string {
  return JSON.stringify(heartbeat, null, 2) + "\n";
}

/**
 * Parse a heartbeat, or null when the bytes are not one.
 *
 * Total, like every parser in `operationLog.ts`: the file is written by a
 * process that can be killed mid-write, so a truncated or empty file is the
 * normal failure and must read as "nothing to say" rather than throw into a
 * report. Every field is checked — a partially written object would otherwise
 * render a line with `undefined` in it.
 */
export function parseHeartbeat(content: string): Heartbeat | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.token !== "string" || raw.token.length === 0) return null;
  if (typeof raw.updatedAt !== "string") return null;
  if (!isPhase(raw.phase)) return null;
  return {
    token: raw.token,
    updatedAt: raw.updatedAt,
    phase: raw.phase,
    item: parseItem(raw.item),
    executor: parseExecutor(raw.executor),
  };
}

function parseItem(value: unknown): HeartbeatItem | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.index !== "number" || typeof raw.total !== "number") return null;
  if (typeof raw.subject !== "string") return null;
  return { index: raw.index, total: raw.total, subject: raw.subject };
}

function parseExecutor(value: unknown): HeartbeatExecutor | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.command !== "string" || typeof raw.startedAt !== "string") return null;
  return { command: raw.command, startedAt: raw.startedAt };
}

/**
 * Publish the current state. The only function here that writes.
 *
 * Written whole rather than patched: the record is a few hundred bytes, it is
 * rewritten several times a tick, and a partial-write window on a diagnostic
 * matters far less than any mechanism that could make a tick wait on it. A
 * reader that meets a half-written file gets null from `parseHeartbeat`, which
 * is the same answer as "no heartbeat yet".
 */
export function writeHeartbeat(
  token: string,
  update: HeartbeatUpdate,
  cwd: string = process.cwd(),
  now: Date = new Date(),
): void {
  try {
    writeFileSync(heartbeatPath(cwd), formatHeartbeat(buildHeartbeat(token, update, now)), "utf8");
  } catch {
    // Diagnostics must never take down the tick they are describing. The
    // `.automata` directory is created by `acquireRunLock` before any caller
    // reaches here, so the realistic failures are a read-only checkout and a
    // full disk — both of which the tick itself should be allowed to survive.
  }
}

/**
 * Remove the sidecar, on the way out of a tick.
 *
 * Best-effort, and a leftover is harmless: the next holder's token will not
 * match, so `readHeartbeat` answers null for it either way. The unlink exists so
 * a checkout is not left with a stale file an operator might read by hand.
 */
export function clearHeartbeat(cwd: string = process.cwd()): void {
  try {
    unlinkSync(heartbeatPath(cwd));
  } catch {
    // Already gone, or never written.
  }
}

/**
 * The heartbeat belonging to `token`, or null.
 *
 * Null covers absent, unreadable, unparseable and — the case this argument
 * exists for — written by a different holder. Presenting a dead holder's last
 * phase as the live tick's would make the feature actively misleading, which is
 * worse than the silence it replaces.
 */
export function readHeartbeat(token: string, cwd: string = process.cwd()): Heartbeat | null {
  let content: string;
  try {
    content = readFileSync(heartbeatPath(cwd), "utf8");
  } catch {
    return null;
  }
  const heartbeat = parseHeartbeat(content);
  if (heartbeat === null || heartbeat.token !== token) return null;
  return heartbeat;
}
