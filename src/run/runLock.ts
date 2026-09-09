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
 * Take over a stale lock atomically.
 *
 * Unlinking and then creating is not exclusive: two contenders can both read the
 * lock as stale, and the second one's unlink deletes the *first* one's freshly
 * written lock, so both proceed into one checkout. `rename` is atomic and
 * replaces unconditionally, so instead both contenders write their own
 * candidate and rename it into place, then read back — exactly one token
 * survives, and only its owner has the lock.
 */
function reclaim(path: string, command: string, token: string): AcquireResult {
  const candidate = `${path}.${token}`;
  try {
    write(candidate, command, token, "w");
    renameSync(candidate, path);
  } catch (err) {
    try {
      unlinkSync(candidate);
    } catch {
      // Nothing to clean up.
    }
    throw err;
  }

  const winner = readOwner(path);
  if (winner !== null && winner.token === token) {
    return { ok: true, handle: makeHandle(path, token) };
  }
  return { ok: false, heldBy: winner ?? UNKNOWN_OWNER };
}
