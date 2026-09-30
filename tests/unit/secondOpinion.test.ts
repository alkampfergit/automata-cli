import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const mockSpawn = vi.fn();
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...a: unknown[]) => mockSpawn(...a) };
});

import { buildScrubPrompt, interpretScrubOutput, scrubExcerpt } from "../../src/run/secondOpinion.js";

function fakeChild(stdout: string, code: number | null, signal: string | null = null) {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof vi.fn> };
  child.stdout = new EventEmitter();
  child.kill = vi.fn();
  setImmediate(() => {
    child.stdout.emit("data", Buffer.from(stdout));
    child.emit("close", code, signal);
  });
  return child;
}

beforeEach(() => {
  mockSpawn.mockReset();
});

describe("buildScrubPrompt", () => {
  it("embeds the excerpt between markers and forbids tools and commentary", () => {
    const prompt = buildScrubPrompt("line one");
    expect(prompt).toMatch(/BEGIN-TEXT\nline one\nEND-TEXT$/);
    expect(prompt).toMatch(/Do not use any tool/);
    expect(prompt).toMatch(/\[REDACTED\]/);
  });
});

describe("interpretScrubOutput", () => {
  it("accepts a filtered text", () => {
    expect(interpretScrubOutput("  ok [REDACTED]\n", "ok hunter2")).toEqual({ ok: true, text: "ok [REDACTED]" });
  });

  it("runs the deterministic redaction again on what came back", () => {
    const out = interpretScrubOutput("token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "x".repeat(100));
    expect(out.ok && out.text).not.toContain("ghp_");
    const again = interpretScrubOutput("GH_TOKEN=abc123def456", "GH_TOKEN=abc123def456");
    expect(again.ok && again.text).not.toContain("abc123def456");
  });

  it("rejects an empty answer and an answer much longer than the input", () => {
    expect(interpretScrubOutput("  \n", "abc")).toMatchObject({ ok: false });
    expect(interpretScrubOutput("y".repeat(1000), "abc")).toMatchObject({ ok: false });
  });
});

describe("scrubExcerpt", () => {
  it("asks claude for a plain, tool-less print run and returns its output", async () => {
    mockSpawn.mockReturnValue(fakeChild("clean text\n", 0));
    const result = await scrubExcerpt({ executor: "claude", model: "m1" }, "clean text");
    expect(result).toEqual({ ok: true, text: "clean text" });
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("-p");
    expect(args).toContain("m1");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("uses codex exec without bypassing the sandbox when the turn ran on codex", async () => {
    mockSpawn.mockReturnValue(fakeChild("clean", 0));
    await scrubExcerpt({ executor: "codex" }, "clean");
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args[0]).toBe("exec");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("reports a non-zero exit without echoing any output", async () => {
    mockSpawn.mockReturnValue(fakeChild("secret leftovers", 1));
    const result = await scrubExcerpt({ executor: "claude" }, "x");
    expect(result).toEqual({ ok: false, reason: "Claude Code exited with code 1" });
  });

  it("reports a signal", async () => {
    mockSpawn.mockReturnValue(fakeChild("", null, "SIGTERM"));
    expect(await scrubExcerpt({ executor: "codex" }, "x")).toEqual({ ok: false, reason: "Codex terminated on SIGTERM" });
  });

  it("reports a missing binary", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => child.emit("error", Object.assign(new Error("spawn"), { code: "ENOENT" })));
    mockSpawn.mockReturnValue(child);
    expect(await scrubExcerpt({ executor: "claude" }, "x")).toEqual({
      ok: false,
      reason: "`claude` CLI is not installed or not on PATH",
    });
  });

  it("kills the child and reports a timeout", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof vi.fn> };
    child.stdout = new EventEmitter();
    child.kill = vi.fn(() => {
      setImmediate(() => child.emit("close", null, "SIGKILL"));
      return true;
    });
    mockSpawn.mockReturnValue(child);
    const result = await scrubExcerpt({ executor: "claude" }, "x", 10);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(result).toEqual({ ok: false, reason: "Claude Code did not answer within 0.01s" });
  });
});
