import { writeFileSync, readFileSync, unlinkSync, mkdirSync, renameSync, linkSync } from "node:fs";
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
  /**
   * The holding process's own start time, where the platform exposes it. Pids
   * are reused, so liveness alone cannot tell "our old tick" from "whatever
   * inherited its pid".
   */
  pidStartedAt?: string;
}

export interface LockHandle {
  release(): void;
}

export type AcquireResult =
  | { ok: true; handle: LockHandle }
  /**
   * `suspect` marks a same-host lock that looks alive but has outlived the
   * staleness window, which on a host where the pid start time is unavailable
   * cannot be distinguished from a pid-reuse orphan. The caller should complain
   * loudly rather than exit 0, or an operator has no way to notice a loop that
   * has quietly stopped working.
   */
  | { ok: false; heldBy: LockOwner; suspect: boolean };

function lockPath(): string {
  return join(process.cwd(), LOCK_DIR, LOCK_FILE);
}

/**
 * The process's start time, as an opaque comparable string, or null when the
 * platform does not expose it cheaply. Linux `/proc/<pid>/stat` field 22 is the
 * start time in clock ticks since boot — stable for the life of the process and
 * enough to tell a reused pid from the original.
 */
function processStartedAt(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    // The comm field can contain spaces and parentheses, so split after it.
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
    const field = afterComm.split(" ")[19];
    return field === undefined || field.length === 0 ? null : field;
  } catch {
    return null;
  }
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
      pidStartedAt: parsed.pidStartedAt,
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
  //
  // Liveness is not proof of identity, though: pids are small and reused in a
  // container, so an unrelated process can inherit the pid of a killed tick and
  // keep the lock alive forever. `pidStartedAt` is compared where the platform
  // exposes it, which retires that case; where it does not, `acquireRunLock`
  // reports the lock as suspect so the caller can complain loudly rather than
  // idling at exit 0.
  if (owner.host === hostname()) {
    if (!isAlive(owner.pid)) return true;
    const startedAt = processStartedAt(owner.pid);
    if (owner.pidStartedAt !== undefined && startedAt !== null && startedAt !== owner.pidStartedAt) {
      return true;
    }
    return false;
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
 * *replacement* holder's lock on its way out, admitting a third tick. Checking
 * the token first is not enough on its own either: between the read and the
 * unlink, a claimant could rename our lock away and write its own, and we would
 * then delete theirs.
 *
 * So the file is taken away by rename before being inspected. If it turns out
 * not to be ours, it is put back with `link`, which refuses to clobber a lock
 * created in the meantime — the outcome being that we never delete or overwrite
 * another holder's lock.
 *
 * Residual: between the rename and the restore there is a sub-millisecond window
 * in which the lock file is absent, so a fresh contender could acquire. That can
 * only arise when our own lock had already been judged stale and replaced, which
 * on this host is impossible while this process is alive (staleness requires a
 * dead pid) and cross-host requires the tick to have outlived
 * `lockStaleMinutes`. Closing it fully needs `flock`, which Node does not expose
 * without a native dependency.
 */
/** A live same-host lock that has outlived the staleness window. */
function heldTooLong(owner: LockOwner, staleMinutes: number): boolean {
  if (owner.host !== hostname()) return false;
  // With a verifiable pid start time there is no ambiguity, so nothing to flag.
  if (owner.pidStartedAt !== undefined && processStartedAt(owner.pid) !== null) return false;
  const startedAt = Date.parse(owner.startedAt);
  if (Number.isNaN(startedAt)) return true;
  return Date.now() - startedAt > staleMinutes * 60 * 1000;
}

function makeHandle(path: string, token: string): LockHandle {
  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;

      const current = readOwner(path);
      if (current !== null && current.token !== token) {
        // Not ours any more: leave it entirely alone.
        return;
      }

      const takenAway = `${path}.releasing.${token}`;
      try {
        renameSync(path, takenAway);
      } catch {
        // Already gone: nothing to release.
        return;
      }

      const owner = readOwner(takenAway);
      if (owner === null || owner.token === token) {
        try {
          unlinkSync(takenAway);
        } catch {
          // Already gone.
        }
        return;
      }

      // We took someone else's lock away; put it back without clobbering a lock
      // written since, then drop our copy either way.
      try {
        linkSync(takenAway, path);
      } catch {
        // A newer lock already occupies the path; theirs stands.
      }
      try {
        unlinkSync(takenAway);
      } catch {
        // Already gone.
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
    pidStartedAt: processStartedAt(process.pid) ?? undefined,
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
    const held = owner as LockOwner;
    return { ok: false, heldBy: held, suspect: heldTooLong(held, staleMinutes) };
  }

  return reclaim(path, command, token, owner);
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
export function claimStaleLock(path: string, token: string, expected?: LockOwner | null): boolean {
  const claimed = `${path}.stale.${token}`;
  try {
    renameSync(path, claimed);
  } catch (err) {
    // ENOENT: another contender claimed it first. Anything else is a real fault.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }

  // "Exactly one rename wins" only holds while nothing recreates the path. A
  // contender that renamed the stale file away and then wrote its own lock
  // leaves the path occupied again — and a second contender still acting on its
  // earlier "this is stale" reading would rename that *live* lock away and
  // destroy it. So verify we took away the file we judged stale, and put it back
  // if not.
  if (expected !== undefined) {
    const taken = readOwner(claimed);
    const sameFile =
      (expected === null && taken === null) ||
      (expected !== null && taken !== null && taken.token === expected.token);
    if (!sameFile) {
      try {
        linkSync(claimed, path);
      } catch {
        // A newer lock already occupies the path; it stands.
      }
      try {
        unlinkSync(claimed);
      } catch {
        // Already gone.
      }
      return false;
    }
  }

  return true;
}

function reclaim(path: string, command: string, token: string, expected: LockOwner | null): AcquireResult {
  if (!claimStaleLock(path, token, expected)) {
    // Someone else is taking it over; whatever they write is authoritative.
    return { ok: false, heldBy: readOwner(path) ?? UNKNOWN_OWNER, suspect: false };
  }

  const claimed = `${path}.stale.${token}`;
  try {
    // The path is free and only this contender may fill it, so "wx" should
    // succeed; if it does not, a third party got there and owns the lock.
    write(path, command, token, "wx");
    return { ok: true, handle: makeHandle(path, token) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    return { ok: false, heldBy: readOwner(path) ?? UNKNOWN_OWNER, suspect: false };
  } finally {
    try {
      unlinkSync(claimed);
    } catch {
      // Already gone.
    }
  }
}
