import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  utimesSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { acquireRunLock, claimStaleLock, inspectRunLock } from "../../src/run/runLock.js";
import { heartbeatPath, parseHeartbeat, writeHeartbeat } from "../../src/run/heartbeat.js";

const ORIG_CWD = process.cwd;
const TEST_CWD = join(process.cwd(), "tmp-test-runlock");

function lockFile(): string {
  return join(TEST_CWD, ".automata", "automata.lock");
}

function writeLock(owner: Record<string, unknown> | string): void {
  mkdirSync(join(TEST_CWD, ".automata"), { recursive: true });
  writeFileSync(lockFile(), typeof owner === "string" ? owner : JSON.stringify(owner));
}

beforeEach(() => {
  mkdirSync(TEST_CWD, { recursive: true });
  process.cwd = () => TEST_CWD;
});

afterEach(() => {
  process.cwd = ORIG_CWD;
  rmSync(TEST_CWD, { recursive: true, force: true });
});

describe("acquireRunLock", () => {
  it("acquires the lock in a clean repository and records the owner", () => {
    const result = acquireRunLock("do-work", 120);
    expect(result.ok).toBe(true);
    const owner = JSON.parse(readFileSync(lockFile(), "utf8")) as Record<string, unknown>;
    expect(owner.pid).toBe(process.pid);
    expect(owner.command).toBe("do-work");
    expect(owner.host).toBe(hostname());
    expect(typeof owner.startedAt).toBe("string");
    // The operation logs live in `dirname(cwd)`, so where the holder ran from is
    // the difference between "no tick has ever run" and "you are reading the
    // wrong directory".
    expect(owner.cwd).toBe(TEST_CWD);
  });

  it("refuses when a live process on this host holds the lock", () => {
    writeLock({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    const result = acquireRunLock("do-work", 120);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.heldBy.pid).toBe(process.pid);
    expect(result.heldBy.command).toBe("do-work");
  });

  it("reclaims a lock whose process is gone", () => {
    // pid 2^22 is above the maximum pid on the platforms we target, so it cannot exist.
    writeLock({ pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    expect(acquireRunLock("do-work", 120).ok).toBe(true);
  });

  it("reclaims a lock older than the staleness window when its host is unknown", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    writeLock({ pid: process.pid, startedAt: twoHoursAgo, host: "some-other-box", command: "do-work" });
    expect(acquireRunLock("do-work", 60).ok).toBe(true);
  });

  it("does NOT steal a lock from a live process on this host, however old it is", () => {
    // A legitimate tick can outlive the staleness window — the run cap is
    // unlimited by default — and stealing its lock would put two model sessions
    // in one checkout, which is exactly what the lock exists to prevent.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    writeLock({ pid: process.pid, startedAt: twoHoursAgo, host: hostname(), command: "do-work" });
    const result = acquireRunLock("do-work", 60);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.heldBy.pid).toBe(process.pid);
  });

  it("reclaims a dead same-host lock regardless of age", () => {
    const justNow = new Date().toISOString();
    writeLock({ pid: 4194304, startedAt: justNow, host: hostname(), command: "do-work" });
    expect(acquireRunLock("do-work", 60).ok).toBe(true);
  });

  it("flags a same-host lock held past the staleness window as suspect", () => {
    // Pids are reused in a container, so a live pid is not proof that *our* tick
    // is running. Where the pid start time cannot be verified, an over-age live
    // lock is reported as suspect so the caller can complain rather than idling
    // at exit 0 forever.
    const longAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeLock({ pid: process.pid, startedAt: longAgo, host: hostname(), command: "do-work", token: "t" });
    const result = acquireRunLock("do-work", 60);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.suspect).toBe(true);
  });

  it("does not flag a recently taken same-host lock", () => {
    writeLock({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), command: "do-work", token: "t" });
    const result = acquireRunLock("do-work", 60);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.suspect).toBe(false);
  });

  it("keeps a fresh lock held by another host", () => {
    writeLock({ pid: process.pid, startedAt: new Date().toISOString(), host: "some-other-box", command: "do-work" });
    const result = acquireRunLock("do-work", 60);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.heldBy.host).toBe("some-other-box");
  });

  it("reclaims an unparseable lock file", () => {
    writeLock("not json at all");
    expect(acquireRunLock("do-work", 120).ok).toBe(true);
  });

  it("reclaims a lock with an unparseable timestamp", () => {
    writeLock({ pid: process.pid, startedAt: "whenever", host: "some-other-box", command: "do-work" });
    expect(acquireRunLock("do-work", 120).ok).toBe(true);
  });

  it("releases the lock, and release is idempotent", () => {
    const result = acquireRunLock("do-work", 120);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.handle.release();
    expect(existsSync(lockFile())).toBe(false);
    expect(() => result.handle.release()).not.toThrow();
  });

  it("records a unique ownership token per acquisition", () => {
    const first = acquireRunLock("do-work", 120);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const tokenA = (JSON.parse(readFileSync(lockFile(), "utf8")) as { token: string }).token;
    first.handle.release();

    const second = acquireRunLock("do-work", 120);
    expect(second.ok).toBe(true);
    const tokenB = (JSON.parse(readFileSync(lockFile(), "utf8")) as { token: string }).token;
    expect(tokenA).toBeTruthy();
    expect(tokenB).not.toBe(tokenA);
  });

  it("does not delete a replacement holder's lock when a superseded holder releases", () => {
    // Acquire, then simulate our lock having been reclaimed as stale and
    // replaced by another tick. Our release must not evict that tick.
    const mine = acquireRunLock("do-work", 120);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;

    writeLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      host: hostname(),
      command: "do-work",
      token: "a-different-holder",
    });

    mine.handle.release();

    expect(existsSync(lockFile())).toBe(true);
    expect((JSON.parse(readFileSync(lockFile(), "utf8")) as { token: string }).token).toBe(
      "a-different-holder",
    );
  });

  it("never deletes a lock written by a later holder", () => {
    // Checking the token then unlinking is a TOCTOU: a claimant could rename our
    // lock away and write its own between the two steps. Release takes the file
    // away by rename before inspecting it, and restores it if it is not ours.
    const mine = acquireRunLock("do-work", 120);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;

    writeLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      host: hostname(),
      command: "do-work",
      token: "a-later-holder",
    });

    mine.handle.release();

    expect(existsSync(lockFile())).toBe(true);
    expect((JSON.parse(readFileSync(lockFile(), "utf8")) as { token: string }).token).toBe("a-later-holder");
    // No temporary files left behind either.
    expect(readdirSync(join(TEST_CWD, ".automata")).filter((f) => f !== "automata.lock")).toEqual([]);
  });

  it("leaves a lock it cannot prove it owns", () => {
    // A lock file with no token cannot be attributed to this handle, so release
    // leaves it alone rather than risk evicting another holder. It is still
    // reclaimable through the liveness and staleness checks.
    const mine = acquireRunLock("do-work", 120);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    writeLock({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    mine.handle.release();
    expect(existsSync(lockFile())).toBe(true);
  });

  it("lets exactly one contender claim a stale lock", () => {
    // The race cannot be reproduced by sequential acquisition, so the claim
    // primitive is driven directly: two contenders, one stale lock. Renaming our
    // own candidate over the lock would let both win, because `rename` replaces
    // unconditionally; renaming the existing file *away* cannot.
    writeLock({ pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });

    const first = claimStaleLock(lockFile(), "token-a");
    const second = claimStaleLock(lockFile(), "token-b");

    expect([first, second]).toEqual([true, false]);
  });

  it("refuses to claim a lock that is no longer the stale one it judged", () => {
    // "Exactly one rename wins" only holds while nothing recreates the path. A
    // contender that already renamed the stale file away and written its own
    // lock leaves the path occupied again — and a second contender still acting
    // on its earlier reading would rename that *live* lock away and destroy it.
    const stale = { pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work", token: "stale" };
    writeLock(stale);
    const judged = JSON.parse(readFileSync(lockFile(), "utf8")) as { token: string };

    // A live replacement now occupies the path.
    writeLock({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), command: "do-work", token: "live" });

    const claimed = claimStaleLock(lockFile(), "late-contender", judged as never);
    expect(claimed).toBe(false);
    // The live lock is intact, and no stray files remain.
    expect((JSON.parse(readFileSync(lockFile(), "utf8")) as { token: string }).token).toBe("live");
    expect(readdirSync(join(TEST_CWD, ".automata")).filter((f) => f !== "automata.lock")).toEqual([]);
  });

  it("serialises reclaim behind a claim file, so a contender cannot touch a live lock", () => {
    // Verify-after-rename alone is not enough: with three contenders, one can
    // rename a *live* lock away and, if the restore then loses a race, delete
    // it. Only the winner of an exclusive `wx` claim may touch the lock at all.
    writeLock({ pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    writeFileSync(join(TEST_CWD, ".automata", "automata.lock.claim"), JSON.stringify({ pid: 1, at: new Date().toISOString() }));

    const result = acquireRunLock("do-work", 120);

    expect(result.ok).toBe(false);
    // The stale lock is untouched — the contender that holds the claim owns it.
    expect((JSON.parse(readFileSync(lockFile(), "utf8")) as { pid: number }).pid).toBe(4194304);
  });

  it("recovers from an empty claim file rather than wedging the lock forever", () => {
    // A signal between the exclusive create and the write leaves the claim
    // empty. Treating an unreadable claim as current made every later tick
    // report "another instance is running" and exit 0 — a dead loop looking
    // healthy, which is exactly what the suspect mechanism exists to prevent.
    writeLock({ pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    const claim = join(TEST_CWD, ".automata", "automata.lock.claim");
    writeFileSync(claim, "");
    // Backdate it so the age test can retire it via mtime.
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(claim, old, old);

    expect(acquireRunLock("do-work", 120).ok).toBe(true);
    expect(existsSync(claim)).toBe(false);
  });

  it("reports a lock it cannot claim as suspect when the owner is gone", () => {
    writeLock({ pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    writeFileSync(
      join(TEST_CWD, ".automata", "automata.lock.claim"),
      JSON.stringify({ pid: 1, at: new Date().toISOString() }),
    );
    const result = acquireRunLock("do-work", 120);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Nothing is really running, so the caller must not report a healthy tick.
    expect(result.suspect).toBe(true);
  });

  it("reclaims an abandoned claim file, so one crash cannot wedge the lock forever", () => {
    writeLock({ pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    const longAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writeFileSync(join(TEST_CWD, ".automata", "automata.lock.claim"), JSON.stringify({ pid: 1, at: longAgo }));

    expect(acquireRunLock("do-work", 120).ok).toBe(true);
    // And the claim file is cleaned up behind it.
    expect(existsSync(join(TEST_CWD, ".automata", "automata.lock.claim"))).toBe(false);
  });

  it("leaves no claim or candidate files behind after a successful reclaim", () => {
    writeLock({ pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    expect(acquireRunLock("do-work", 120).ok).toBe(true);
    expect(readdirSync(join(TEST_CWD, ".automata")).filter((f) => f !== "automata.lock")).toEqual([]);
  });

  it("reports no claim when there is no stale lock to take over", () => {
    expect(claimStaleLock(lockFile(), "token-a")).toBe(false);
  });

  it("reclaims atomically, so a second contender cannot evict the first", () => {
    // The old unlink-then-create sequence let two contenders both see the lock
    // as stale, and the second one'"'"'s unlink deleted the first one'"'"'s new lock —
    // admitting two ticks into one checkout.
    writeLock({ pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });

    const first = acquireRunLock("do-work", 120);
    expect(first.ok).toBe(true);

    // A second contender now arrives and sees a live, fresh lock.
    const second = acquireRunLock("do-work", 120);
    expect(second.ok).toBe(false);

    // The winner still owns the file it wrote.
    const owner = JSON.parse(readFileSync(lockFile(), "utf8")) as { pid: number };
    expect(owner.pid).toBe(process.pid);
  });

  it("leaves no candidate files behind after a reclaim", () => {
    writeLock({ pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    expect(acquireRunLock("do-work", 120).ok).toBe(true);
    const strays = readdirSync(join(TEST_CWD, ".automata")).filter((f) => f !== "automata.lock");
    expect(strays).toEqual([]);
  });

  it("exports the lock path so the cleanliness check can exclude it", async () => {
    const { RUN_LOCK_RELATIVE_PATH } = await import("../../src/run/runLock.js");
    expect(RUN_LOCK_RELATIVE_PATH).toBe(".automata/automata.lock");
  });

  it("allows a fresh acquisition after release", () => {
    const first = acquireRunLock("do-work", 120);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    first.handle.release();
    expect(acquireRunLock("do-work", 120).ok).toBe(true);
  });
});

describe("inspectRunLock", () => {
  it("reports a clean repository as free without creating anything", () => {
    expect(inspectRunLock(120)).toEqual({ kind: "free" });
    // The whole point of not reusing `acquireRunLock`: a diagnostic must not
    // plant a lock file in a repository that has not ignored it.
    expect(existsSync(lockFile())).toBe(false);
  });

  it("reports a live same-host lock as held, and names its owner", () => {
    const acquired = acquireRunLock("do-work", 120);
    expect(acquired.ok).toBe(true);

    const status = inspectRunLock(120);
    expect(status.kind).toBe("held");
    if (status.kind !== "held") return;
    expect(status.owner.pid).toBe(process.pid);
    expect(status.owner.command).toBe("do-work");
    expect(status.owner.host).toBe(hostname());
    expect(status.heldForMs).toBeGreaterThanOrEqual(0);
  });

  it("carries a lock written without a working directory rather than rejecting it", () => {
    writeLock({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    const status = inspectRunLock(120);
    expect(status.kind).toBe("held");
    if (status.kind !== "held") return;
    expect(status.owner.cwd).toBeUndefined();
  });

  it("attaches the holder's own heartbeat", () => {
    const acquired = acquireRunLock("do-work", 120);
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    acquired.handle.heartbeat({ phase: "item", item: { index: 2, total: 5, subject: "#82" } });

    const status = inspectRunLock(120);
    expect(status.kind).toBe("held");
    if (status.kind !== "held") return;
    expect(status.heartbeat?.phase).toBe("item");
    expect(status.heartbeat?.item).toEqual({ index: 2, total: 5, subject: "#82" });
  });

  it("ignores a heartbeat left behind by a previous holder", () => {
    // Left by a tick that was killed: the directory survives, the lock does not.
    mkdirSync(join(TEST_CWD, ".automata"), { recursive: true });
    writeHeartbeat("tok-from-a-dead-tick", { phase: "discovery" }, TEST_CWD);
    const acquired = acquireRunLock("do-work", 120);
    expect(acquired.ok).toBe(true);

    const status = inspectRunLock(120);
    expect(status.kind).toBe("held");
    if (status.kind !== "held") return;
    // The file is still readable; it simply is not this lock's.
    expect(parseHeartbeat(readFileSync(heartbeatPath(TEST_CWD), "utf8"))).not.toBeNull();
    expect(status.heartbeat).toBeNull();
  });

  it("reads the heartbeat from the holder's working directory, not the checker's", () => {
    // The case the whole feature exists for: the scheduler fires the tick from
    // another checkout. Reading our own cwd here would report "no heartbeat"
    // for every such tick — exactly when the phase is what is being asked for.
    const holderCwd = join(TEST_CWD, "elsewhere");
    mkdirSync(join(holderCwd, ".automata"), { recursive: true });
    writeLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      host: hostname(),
      command: "do-work",
      token: "tok-holder",
      cwd: holderCwd,
    });
    writeHeartbeat("tok-holder", { phase: "item", item: { index: 3, total: 8, subject: "#82" } }, holderCwd);

    const status = inspectRunLock(120);
    expect(status.kind).toBe("held");
    if (status.kind !== "held") return;
    expect(status.heartbeat?.item).toEqual({ index: 3, total: 8, subject: "#82" });
    // Nothing was written beside the checker; the read came from the lock's cwd.
    expect(existsSync(heartbeatPath(TEST_CWD))).toBe(false);
  });

  it("falls back to the current directory for a lock that records no cwd", () => {
    // Written by an automata from before the field existed.
    mkdirSync(join(TEST_CWD, ".automata"), { recursive: true });
    writeLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      host: hostname(),
      command: "do-work",
      token: "tok-legacy",
    });
    writeHeartbeat("tok-legacy", { phase: "discovery" }, TEST_CWD);

    const status = inspectRunLock(120);
    expect(status.kind).toBe("held");
    if (status.kind !== "held") return;
    expect(status.heartbeat?.phase).toBe("discovery");
  });

  it("does not delete a replacement holder's heartbeat when a stale handle releases", () => {
    const acquired = acquireRunLock("do-work", 120);
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    acquired.handle.heartbeat({ phase: "pre-flight" });

    // Our lock is reclaimed as stale and a new tick takes over, sidecar and all.
    rmSync(lockFile(), { force: true });
    writeLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      host: hostname(),
      command: "do-work",
      token: "tok-replacement",
      cwd: TEST_CWD,
    });
    writeHeartbeat("tok-replacement", { phase: "item", item: { index: 1, total: 2, subject: "#7" } }, TEST_CWD);

    acquired.handle.release();

    // The lock is intact and so is its phase: a blind unlink here would have
    // left a live tick observable only as "running", which is the blind spot.
    const status = inspectRunLock(120);
    expect(status.kind).toBe("held");
    if (status.kind !== "held") return;
    expect(status.heartbeat?.phase).toBe("item");
  });

  it("clears the heartbeat when the lock is released, and stops publishing after", () => {
    const acquired = acquireRunLock("do-work", 120);
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    acquired.handle.heartbeat({ phase: "pre-flight" });
    expect(existsSync(heartbeatPath(TEST_CWD))).toBe(true);

    acquired.handle.release();
    expect(existsSync(heartbeatPath(TEST_CWD))).toBe(false);

    // A released handle must not resurrect the file: the lock may already belong
    // to another tick.
    acquired.handle.heartbeat({ phase: "summary" });
    expect(existsSync(heartbeatPath(TEST_CWD))).toBe(false);
  });

  it("reports a lock whose pid is dead as stale", () => {
    // A pid far above the default pid_max, so it cannot be alive.
    writeLock({ pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    const status = inspectRunLock(120);
    expect(status.kind).toBe("stale");
    if (status.kind !== "stale") return;
    expect(status.owner?.pid).toBe(4194304);
  });

  it("reports an unparseable lock as stale with no owner", () => {
    writeLock("{ not json");
    expect(inspectRunLock(120)).toEqual({ kind: "stale", owner: null, heldForMs: null });
  });

  // Root bypasses the mode bits, so the case cannot be provoked there.
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(asRoot)("reports a lock it cannot open as unreadable, not as stale", () => {
    // `readOwner` answers null for an I/O failure and for malformed contents
    // alike. Calling the first "stale" tells the operator the next tick will
    // reclaim it, when that tick will fail on the very same permissions.
    writeLock({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" });
    chmodSync(lockFile(), 0o000);
    try {
      const status = inspectRunLock(120);
      expect(status.kind).toBe("unreadable");
      if (status.kind !== "unreadable") return;
      expect(status.detail.length).toBeGreaterThan(0);
    } finally {
      chmodSync(lockFile(), 0o644);
    }
  });

  it("reports a live same-host lock past the staleness window as suspect", () => {
    // No `pidStartedAt`, so the holder's identity cannot be verified — the
    // pid-reuse case `acquireRunLock` flags rather than reclaiming.
    writeLock({
      pid: process.pid,
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      host: hostname(),
      command: "do-work",
    });
    const status = inspectRunLock(120);
    expect(status.kind).toBe("suspect");
    if (status.kind !== "suspect") return;
    expect(status.heldForMs).toBeGreaterThan(2 * 60 * 60 * 1000);
  });

  it("does not call a live in-window lock suspect", () => {
    writeLock({
      pid: process.pid,
      startedAt: new Date(Date.now() - 60 * 1000).toISOString(),
      host: hostname(),
      command: "do-work",
    });
    expect(inspectRunLock(120).kind).toBe("held");
  });

  it("reports a foreign-host lock inside the window as held and past it as stale", () => {
    writeLock({
      pid: 1,
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      host: "another-host",
      command: "do-work",
    });
    expect(inspectRunLock(120).kind).toBe("held");

    writeLock({
      pid: 1,
      startedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
      host: "another-host",
      command: "do-work",
    });
    expect(inspectRunLock(120).kind).toBe("stale");
  });

  it("leaves the lock file exactly as it found it", () => {
    const owner = { pid: 4194304, startedAt: new Date().toISOString(), host: hostname(), command: "do-work" };
    writeLock(owner);
    const before = readFileSync(lockFile(), "utf8");
    inspectRunLock(120);
    inspectRunLock(1);
    expect(readFileSync(lockFile(), "utf8")).toBe(before);
    expect(readdirSync(join(TEST_CWD, ".automata"))).toEqual(["automata.lock"]);
  });
});
