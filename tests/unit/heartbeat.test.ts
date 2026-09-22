import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHeartbeat,
  clearHeartbeat,
  formatHeartbeat,
  heartbeatPath,
  parseHeartbeat,
  readHeartbeat,
  writeHeartbeat,
  HEARTBEAT_RELATIVE_PATH,
} from "../../src/run/heartbeat.js";

const NOW = new Date("2026-01-10T12:00:00.000Z");
const created: string[] = [];

/** A checkout with the `.automata` directory the run lock would have made. */
function checkout(): string {
  const dir = mkdtempSync(join(tmpdir(), "automata-heartbeat-"));
  mkdirSync(join(dir, ".automata"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("heartbeat", () => {
  it("resolves next to the run lock", () => {
    expect(heartbeatPath("/srv/widgets")).toBe(join("/srv/widgets", HEARTBEAT_RELATIVE_PATH));
  });

  it("round-trips the formatter through the parser", () => {
    const heartbeat = buildHeartbeat(
      "tok-1",
      {
        phase: "item",
        item: { index: 3, total: 8, subject: "#82" },
        executor: { command: "claude", startedAt: NOW.toISOString() },
      },
      NOW,
    );
    expect(parseHeartbeat(formatHeartbeat(heartbeat))).toEqual(heartbeat);
  });

  it("fills the optional halves with null rather than leaving them absent", () => {
    const heartbeat = buildHeartbeat("tok-1", { phase: "discovery" }, NOW);
    expect(heartbeat).toEqual({
      token: "tok-1",
      updatedAt: NOW.toISOString(),
      phase: "discovery",
      item: null,
      executor: null,
    });
  });

  it("reads back what a tick wrote", () => {
    const dir = checkout();
    writeHeartbeat("tok-1", { phase: "pre-flight" }, dir, NOW);

    expect(readHeartbeat("tok-1", dir)?.phase).toBe("pre-flight");
  });

  it("ignores a heartbeat belonging to a previous holder", () => {
    const dir = checkout();
    writeHeartbeat("tok-old", { phase: "item", item: { index: 1, total: 1, subject: "#1" } }, dir);

    // The file is there and parses; it simply is not this lock's.
    expect(parseHeartbeat(readFileSync(heartbeatPath(dir), "utf8"))).not.toBeNull();
    expect(readHeartbeat("tok-new", dir)).toBeNull();
  });

  it("reads a truncated or empty file as nothing to say", () => {
    const dir = checkout();
    writeFileSync(heartbeatPath(dir), '{"token":"tok-1","pha', "utf8");
    expect(readHeartbeat("tok-1", dir)).toBeNull();

    writeFileSync(heartbeatPath(dir), "", "utf8");
    expect(readHeartbeat("tok-1", dir)).toBeNull();
  });

  it("rejects a record missing a field rather than rendering undefined", () => {
    expect(parseHeartbeat(JSON.stringify({ token: "t", updatedAt: "x" }))).toBeNull();
    expect(parseHeartbeat(JSON.stringify({ updatedAt: "x", phase: "item" }))).toBeNull();
    expect(parseHeartbeat(JSON.stringify({ token: "", updatedAt: "x", phase: "item" }))).toBeNull();
    expect(
      parseHeartbeat(JSON.stringify({ token: "t", updatedAt: "x", phase: "nope" })),
    ).toBeNull();
    expect(parseHeartbeat("[]")).toBeNull();
  });

  it("drops a partial item or executor instead of failing the whole record", () => {
    const parsed = parseHeartbeat(
      JSON.stringify({
        token: "t",
        updatedAt: "x",
        phase: "item",
        item: { index: 1, subject: "#1" },
        executor: { command: "claude" },
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.item).toBeNull();
    expect(parsed?.executor).toBeNull();
  });

  it("reads an absent file as nothing to say", () => {
    expect(readHeartbeat("tok-1", checkout())).toBeNull();
  });

  it("never throws, whatever the filesystem does", () => {
    // No `.automata` directory at all: the write has nowhere to go.
    const bare = mkdtempSync(join(tmpdir(), "automata-heartbeat-bare-"));
    created.push(bare);

    expect(() => {
      writeHeartbeat("tok-1", { phase: "summary" }, bare);
    }).not.toThrow();
    expect(() => {
      clearHeartbeat("tok-1", bare);
    }).not.toThrow();
    expect(readHeartbeat("tok-1", bare)).toBeNull();
  });

  it("removes the sidecar", () => {
    const dir = checkout();
    writeHeartbeat("tok-1", { phase: "summary" }, dir);
    clearHeartbeat("tok-1", dir);

    expect(readHeartbeat("tok-1", dir)).toBeNull();
    expect(existsSync(heartbeatPath(dir))).toBe(false);
  });

  it("leaves another holder's sidecar alone", () => {
    // The teardown of a tick whose lock was reclaimed as stale. Deleting here
    // would blind a check to the replacement holder's phase while its lock is
    // perfectly intact.
    const dir = checkout();
    writeHeartbeat("tok-new", { phase: "item", item: { index: 1, total: 4, subject: "#82" } }, dir);

    clearHeartbeat("tok-old", dir);

    expect(readHeartbeat("tok-new", dir)?.phase).toBe("item");
  });
});
