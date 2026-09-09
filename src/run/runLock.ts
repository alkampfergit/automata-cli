import { writeFileSync, readFileSync, unlinkSync, mkdirSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

/**
 * The lock's path relative to the repository root.
 *
 * Exported because the working-tree cleanliness check has to exclude it: the
 * lock is created before that check runs, and in any repository that has not
 * added it to `.gitignore` itself it would otherwise show up as an untracked
 * change and every item would be skipped as `dirty-tree`. Adding it to *this*
 * repository's `.gitignore` does nothing for installations elsewhere.
 */
export const RUN_LOCK_RELATIVE_PATH = `${LOCK_DIR}/${LOCK_FILE}`;

export interface LockOwner {
  pid: number;
  startedAt: string;
  host: string;
  command: string;
  /** Unique per acquisition, so a holder only ever releases its own lock. */
  token: string;
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
      token: parsed.token ?? "",
    };
  } catch {
    return null;
  }
}

function isStale(owner: LockOwner | null, staleMinutes: number): boolean {
  // An unparseable lock is stale: something wrote it badly or died mid-write,
  // and refusing forever would be worse than reclaiming it.
  if (owner === null) return true;

  // On this host liveness is authoritative, and it takes precedence over age: a
  // legitimate tick can outlive the staleness window (the run cap is unlimited
  // by default), and stealing the lock from a running tick would put two model
  // sessions in one checkout — the exact thing the lock exists to prevent.
  if (owner.host === hostname()) {
    return !isAlive(owner.pid);
  }

  // Another host's process cannot be probed, so age is the only signal left.
  const startedAt = Date.parse(owner.startedAt);
  if (Number.isNaN(startedAt)) return true;
  return Date.now() - startedAt > staleMinutes * 60 * 1000;
}

/**
 * Release only the lock this handle created.
 *
 * A blind unlink would let a holder whose lock was reclaimed as stale delete the
 * *replacement* holder's lock on its way out, admitting a third tick.
 */
function makeHandle(path: string, token: string): LockHandle {
  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      const current = readOwner(path);
      if (current !== null && current.token !== token) {
        // Someone else owns the lock now; leaving it alone is the whole point.
        return;
      }
      try {
        unlinkSync(path);
      } catch {
        // Already gone: nothing to release.
      }
    },
  };
}

function write(path: string, command: string, token: string, flag: "wx" | "w" = "wx"): void {
  const owner: LockOwner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: hostname(),
    command,
    token,
  };
  // "wx" fails if the file exists, and that check-and-create is atomic on every
  // platform we target — which is what makes this a lock rather than a hint.
  writeFileSync(path, JSON.stringify(owner, null, 2) + "\n", { encoding: "utf8", flag });
}

export function acquireRunLock(command: string, staleMinutes: number): AcquireResult {
  const path = lockPath();
  const token = randomUUID();
  mkdirSync(join(process.cwd(), LOCK_DIR), { recursive: true });

  try {
    write(path, command, token);
    return { ok: true, handle: makeHandle(path, token) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  const owner = readOwner(path);
  if (!isStale(owner, staleMinutes)) {
    return { ok: false, heldBy: owner as LockOwner };
  }

  return reclaim(path, command, token);
}

const UNKNOWN_OWNER: LockOwner = {
  pid: 0,
  startedAt: "unknown",
  host: "unknown",
  command: "unknown",
  token: "",
};

/**
 * Claim the right to replace a stale lock.
 *
 * This is the mutual-exclusion primitive, and it has to be a single atomic
 * operation that only one contender can win. Renaming *our own candidate* over
 * the lock does not qualify: `rename` replaces unconditionally, so two
 * contenders can each rename and each read their own token back — A reads token
 * A before B renames, and both conclude they hold the lock.
 *
 * Renaming the *existing stale file out of the way* does qualify. The source
 * either exists or it does not: exactly one contender's rename succeeds, and
 * every other gets `ENOENT` because the file is already gone. Winning that
 * rename is what confers the right to create the new lock.
 *
 * Exported for tests, which need to drive two contenders against one stale lock
 * deterministically — the race cannot be reproduced by sequential acquisition.
 */
export function claimStaleLock(path: string, token: string): boolean {
  try {
    renameSync(path, `${path}.stale.${token}`);
    return true;
  } catch (err) {
    // ENOENT: another contender claimed it first. Anything else is a real fault.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function reclaim(path: string, command: string, token: string): AcquireResult {
  if (!claimStaleLock(path, token)) {
    // Someone else is taking it over; whatever they write is authoritative.
    return { ok: false, heldBy: readOwner(path) ?? UNKNOWN_OWNER };
  }

  const claimed = `${path}.stale.${token}`;
  try {
    // The path is free and only this contender may fill it, so "wx" should
    // succeed; if it does not, a third party got there and owns the lock.
    write(path, command, token, "wx");
    return { ok: true, handle: makeHandle(path, token) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    return { ok: false, heldBy: readOwner(path) ?? UNKNOWN_OWNER };
  } finally {
    try {
      unlinkSync(claimed);
    } catch {
      // Already gone.
    }
  }
}
