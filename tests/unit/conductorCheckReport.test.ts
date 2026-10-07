import { describe, it, expect } from "vitest";
import { buildConductorCheck, lockSection, type ConductorCheckInput } from "../../src/conductor/checkReport.js";
import { extractDryRunReply } from "../../src/conductor/dryRunReply.js";

const owner = { pid: 7, host: "h", startedAt: "t", command: "conductor", token: "x" };
const base: ConductorCheckInput = {
  generatedAt: new Date("2026-10-05T00:00:00Z"),
  repo: "acme/widget",
  configProblem: null,
  identity: "alice",
  execution: "claude",
  lock: { kind: "free" },
  staleMinutes: 30,
  watched: [],
};

describe("buildConductorCheck", () => {
  it("is healthy with an empty watch list", () => {
    const check = buildConductorCheck(base);
    expect(check.exitCode).toBe(0);
    expect(check.text).toContain("automata conductor --check — acme/widget — 2026-10-05T00:00:00.000Z");
    expect(check.text).toContain("RESULT: healthy");
  });

  it("reports only the configuration problem when the configuration is unusable", () => {
    const check = buildConductorCheck({ ...base, configProblem: "No agent user configured." });
    expect(check.exitCode).toBe(1);
    expect(check.text).toContain("configuration: No agent user configured.");
    expect(check.text).not.toContain("Run lock");
  });

  it("lists a pending prune and an unreadable item, and only the latter is a problem", () => {
    const check = buildConductorCheck({
      ...base,
      watched: [
        { id: 3, kind: "pr", state: "closed", decisions: [] },
        { id: 4, unavailable: "boom" },
      ],
    });
    expect(check.text).toContain("PR #3: closed, a tick would drop it");
    expect(check.problems.map((p) => p.summary)).toEqual(["#4 could not be read: boom"]);
  });
});

describe("lockSection", () => {
  it("treats free, live and stale locks as healthy", () => {
    expect(lockSection({ kind: "free" }, 30).problems).toEqual([]);
    expect(lockSection({ kind: "held", owner, heldForMs: 1000 }, 30).problems).toEqual([]);
    expect(lockSection({ kind: "stale", owner, heldForMs: null }, 30).problems).toEqual([]);
  });

  it("treats a suspect or unreadable lock as a problem", () => {
    expect(lockSection({ kind: "suspect", owner, heldForMs: 1 }, 30).problems).toHaveLength(1);
    expect(lockSection({ kind: "unreadable", detail: "EACCES" }, 30).problems).toHaveLength(1);
  });
});

describe("extractDryRunReply", () => {
  const result = (text: string) => JSON.stringify({ type: "result", result: text });

  it("takes the last Claude result event and skips lines that are not JSON", () => {
    const raw = ["noise", JSON.stringify({ type: "assistant" }), result("first"), result(" final \n")].join("\n");
    expect(extractDryRunReply("claude", raw)).toBe("final");
  });

  it("takes the whole Codex stdout", () => {
    expect(extractDryRunReply("codex", "  the reply\n")).toBe("the reply");
  });

  it("returns null for no reply", () => {
    expect(extractDryRunReply("claude", JSON.stringify({ type: "assistant" }))).toBeNull();
    expect(extractDryRunReply("codex", "  \n")).toBeNull();
  });
});
