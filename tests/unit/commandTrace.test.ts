import { describe, it, expect, afterEach } from "vitest";
import {
  describeTracedCommand,
  isTracing,
  recordCommand,
  startCommandTrace,
  stopCommandTrace,
  takeCommandTrace,
  MAX_COMMAND_LENGTH,
} from "../../src/run/commandTrace.js";

// The sink is module state shared by every test in this file, so it is cleared
// unconditionally rather than only by the tests that armed it.
afterEach(() => {
  stopCommandTrace();
});

describe("commandTrace", () => {
  it("records nothing until tracing is started", () => {
    recordCommand("git", ["status"], Date.now(), 0);
    expect(takeCommandTrace()).toBeNull();
  });

  it("distinguishes 'no trace was asked for' from 'a trace was asked for and nothing ran'", () => {
    expect(takeCommandTrace()).toBeNull();
    startCommandTrace();
    expect(takeCommandTrace()).toEqual([]);
  });

  it("records the command, its arguments and its exit code, oldest first", () => {
    startCommandTrace();
    recordCommand("git", ["rev-parse", "HEAD"], Date.now(), 0);
    recordCommand("gh", ["issue", "list"], Date.now(), 1);

    const trace = takeCommandTrace();
    expect(trace?.map((entry) => [entry.command, entry.exitCode])).toEqual([
      ["git", 0],
      ["gh", 1],
    ]);
    expect(trace?.[0].args).toEqual(["rev-parse", "HEAD"]);
  });

  it("copies the arguments, so a caller reusing its array cannot rewrite the record", () => {
    startCommandTrace();
    const args = ["status"];
    recordCommand("git", args, Date.now(), 0);
    args[0] = "push";

    expect(takeCommandTrace()?.[0].args).toEqual(["status"]);
  });

  it("never reports a negative duration, even when the clock went backwards", () => {
    startCommandTrace();
    recordCommand("git", ["status"], Date.now() + 10_000, 0);
    expect(takeCommandTrace()?.[0].durationMs).toBe(0);
  });

  it("takes the trace and turns tracing off", () => {
    startCommandTrace();
    expect(isTracing()).toBe(true);
    takeCommandTrace();
    expect(isTracing()).toBe(false);

    recordCommand("git", ["status"], Date.now(), 0);
    expect(takeCommandTrace()).toBeNull();
  });

  it("renders a command with its duration and exit code", () => {
    expect(
      describeTracedCommand({
        command: "git",
        args: ["rev-parse", "--short", "HEAD"],
        durationMs: 8,
        exitCode: 0,
      }),
    ).toBe("git rev-parse --short HEAD — 8ms exit 0");
  });

  it("cuts an argument list long enough to bury the rest of the trace", () => {
    const rendered = describeTracedCommand({
      command: "gh",
      args: ["api", "graphql", "-f", "query=".concat("x".repeat(1000))],
      durationMs: 5,
      exitCode: 0,
    });
    expect(rendered).toContain("…");
    expect(rendered.length).toBeLessThan(MAX_COMMAND_LENGTH + 40);
  });
});
