import { describe, it, expect } from "vitest";
import { conductReply, newMessagesBy } from "../../src/conductor/reply.js";
import { conductorExecutionProblem, resolveConductorExecution } from "../../src/conductor/execution.js";
import type { RawMessage } from "../../src/github/conversation.js";

function msg(author: string, createdAt: string, body = "x"): RawMessage {
  return { kind: "issue-comment", author, body, createdAt };
}

const BEFORE = [msg("bot", "2026-01-01T00:00:00Z"), msg("alice", "2026-01-01T00:01:00Z")];

describe("newMessagesBy", () => {
  it("returns only new messages of the login, ignoring case", () => {
    const after = [...BEFORE, msg("Alice", "2026-01-01T00:02:00Z"), msg("bot", "2026-01-01T00:03:00Z")];
    expect(newMessagesBy(BEFORE, after, "alice")).toHaveLength(1);
  });
});

describe("conductReply", () => {
  it("is posted when the account has a new comment", async () => {
    let calls = 0;
    const outcome = await conductReply({
      login: "alice",
      read: () => (calls++ === 0 ? BEFORE : [...BEFORE, msg("alice", "2026-01-01T00:05:00Z", "reply")]),
      run: () => Promise.resolve(),
    });
    expect(outcome).toEqual({ kind: "posted", count: 1, runError: null });
  });

  it("detects a run that posted nothing", async () => {
    const outcome = await conductReply({ login: "alice", read: () => BEFORE, run: () => Promise.resolve() });
    expect(outcome).toEqual({ kind: "posted-nothing" });
  });

  it("does not count a comment of another account", async () => {
    let calls = 0;
    const outcome = await conductReply({
      login: "alice",
      read: () => (calls++ === 0 ? BEFORE : [...BEFORE, msg("carol", "2026-01-01T00:05:00Z")]),
      run: () => Promise.resolve(),
    });
    expect(outcome.kind).toBe("posted-nothing");
  });

  it("reports a failed run that posted nothing, and keeps a post made before the failure", async () => {
    const failing = () => Promise.reject(new Error("boom"));
    expect(await conductReply({ login: "alice", read: () => BEFORE, run: failing })).toEqual({
      kind: "run-failed",
      error: "boom",
    });
    let calls = 0;
    const outcome = await conductReply({
      login: "alice",
      read: () => (calls++ === 0 ? BEFORE : [...BEFORE, msg("alice", "2026-01-01T00:05:00Z")]),
      run: failing,
    });
    expect(outcome).toEqual({ kind: "posted", count: 1, runError: "boom" });
  });

  it("is unverified when the conversation cannot be read, and does not run the model before the first read", async () => {
    let ran = false;
    const outcome = await conductReply({
      login: "alice",
      read: () => {
        throw new Error("offline");
      },
      run: () => {
        ran = true;
        return Promise.resolve();
      },
    });
    expect(outcome.kind).toBe("unverified");
    expect(ran).toBe(false);
  });
});

describe("conductor execution", () => {
  it("defaults to claude and picks the model and effort of the chosen executor", () => {
    expect(resolveConductorExecution(undefined)).toEqual({ executor: "claude", model: undefined, effort: undefined });
    expect(
      resolveConductorExecution({
        executor: "codex",
        models: { claude: "opus", codex: " gpt-x " },
        effort: { claude: "high", codex: " " },
      }),
    ).toEqual({ executor: "codex", model: "gpt-x", effort: undefined });
  });

  it("names a hand-edited setting that cannot work", () => {
    expect(conductorExecutionProblem(undefined)).toBeNull();
    expect(conductorExecutionProblem({ executor: "claude", models: { codex: "m" } })).toBeNull();
    expect(conductorExecutionProblem({ executor: "gpt" as never })).toMatch(/conductor\.executor/);
    expect(conductorExecutionProblem({ models: { gpt: "m" } as never })).toMatch(/conductor\.models\.gpt/);
    expect(conductorExecutionProblem({ effort: { claude: 3 } as never })).toMatch(/conductor\.effort\.claude must be a string/);
    expect(conductorExecutionProblem({ models: "x" as never })).toMatch(/must be an object/);
  });
});
