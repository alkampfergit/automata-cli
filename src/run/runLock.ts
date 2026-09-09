import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

/**
 * An exclusive, repository-scoped run lock.
 *
 * A tick is one or more full model sessions, and cron fires on a fixed interval,
 * so overlap is the normal case rather than the exception. Two automata
 * instances working in the same checkout would fight over the branch and push
 * conflicting commits, so while one holds this lock no other does any work.
 *
 * The file is named for automata as a whole rather than for `do-work`, so other
 * long-running commands can adopt the same lock without inventing a second
 * format.
 */

const LOCK_DIR = ".automata";
const LOCK_FILE = "automata.lock";

export interface LockOwner {
  pid: number;
  startedAt: string;
  host: string;
  command: string;
}

export interface LockHandle {
  release(): void;
}

export type AcquireResult = { ok: true; handle: LockHandle } | { ok: false; heldBy: LockOwner };

function lockPath(): string {
  return join(process.cwd(), LOCK_DIR, LOCK_FILE);
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence checks without signalling.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOwner(path: string): LockOwner | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
    if (typeof parsed.pid !== "number" || typeof parsed.startedAt !== "string") return null;
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      host: parsed.host ?? "unknown",
      command: parsed.command ?? "unknown",
    };
  } catch {
    return null;
  }
}

function isStale(owner: LockOwner | null, staleMinutes: number): boolean {
  // An unparseable lock is stale: something wrote it badly or died mid-write,
  // and refusing forever would be worse than reclaiming it.
  if (owner === null) return true;
  // A lock from another host cannot be checked for liveness, so only age can
  // retire it.
  if (owner.host === hostname() && !isAlive(owner.pid)) return true;
  const startedAt = Date.parse(owner.startedAt);
  if (Number.isNaN(startedAt)) return true;
  return Date.now() - startedAt > staleMinutes * 60 * 1000;
}

function makeHandle(path: string): LockHandle {
  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      try {
        unlinkSync(path);
      } catch {
        // Already gone: nothing to release.
      }
    },
  };
}

function write(path: string, command: string): void {
  const owner: LockOwner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: hostname(),
    command,
  };
  // "wx" fails if the file exists, and that check-and-create is atomic on every
  // platform we target — which is what makes this a lock rather than a hint.
  writeFileSync(path, JSON.stringify(owner, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
}

export function acquireRunLock(command: string, staleMinutes: number): AcquireResult {
  const path = lockPath();
  mkdirSync(join(process.cwd(), LOCK_DIR), { recursive: true });

  try {
    write(path, command);
    return { ok: true, handle: makeHandle(path) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  const owner = readOwner(path);
  if (!isStale(owner, staleMinutes)) {
    return { ok: false, heldBy: owner as LockOwner };
  }

  try {
    unlinkSync(path);
  } catch {
    // Someone else reclaimed it first; the retry below will tell us.
  }

  try {
    write(path, command);
    return { ok: true, handle: makeHandle(path) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const winner = readOwner(path);
    return {
      ok: false,
      heldBy: winner ?? { pid: 0, startedAt: new Date().toISOString(), host: "unknown", command: "unknown" },
    };
  }
}
