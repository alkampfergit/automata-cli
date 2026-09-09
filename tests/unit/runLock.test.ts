import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { acquireRunLock } from "../../src/run/runLock.js";

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

  it("reclaims a lock older than the staleness window even if its host is unknown", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    writeLock({ pid: process.pid, startedAt: twoHoursAgo, host: "some-other-box", command: "do-work" });
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

  it("allows a fresh acquisition after release", () => {
    const first = acquireRunLock("do-work", 120);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    first.handle.release();
    expect(acquireRunLock("do-work", 120).ok).toBe(true);
  });
});
