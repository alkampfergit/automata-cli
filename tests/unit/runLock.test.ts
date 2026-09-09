import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { acquireRunLock, claimStaleLock } from "../../src/run/runLock.js";

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
