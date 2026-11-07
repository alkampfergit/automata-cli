import { describe, it, expect, vi } from "vitest";
import {
  executeDeletions,
  formatEntry,
  planLocalCleanup,
  planRemoteCleanup,
  protectedBranches,
  type CleanupEntry,
  type PullRequestState,
} from "../../src/git/branchCleanup.js";

describe("protectedBranches", () => {
  it("holds develop, master, main, the current branch and the trunk", () => {
    const set = protectedBranches("feature/x", "release-trunk");
    expect([...set].sort()).toEqual(["develop", "feature/x", "main", "master", "release-trunk"]);
  });

  it("ignores a detached HEAD and an unresolved trunk", () => {
    expect([...protectedBranches("HEAD", null)].sort()).toEqual(["develop", "main", "master"]);
  });
});

describe("planLocalCleanup", () => {
  const prot = protectedBranches("work", "main");
  const plan = (unpushed: (b: string) => number | null = () => 0): CleanupEntry[] =>
    planLocalCleanup(["develop", "work", "kept", "gone", "lost"], ["develop", "kept"], prot, "work", unpushed);

  it("deletes only the branches with no origin counterpart", () => {
    const deleted = plan().filter((e) => e.action === "delete").map((e) => e.branch);
    expect(deleted).toEqual(["gone", "lost"]);
  });

  it("keeps the current branch even when origin has no such branch", () => {
    const work = plan().find((e) => e.branch === "work");
    expect(work).toMatchObject({ action: "keep", reason: "current branch" });
  });

  it("keeps a protected branch that origin does not have", () => {
    const entries = planLocalCleanup(["master"], [], prot, "work", () => 0);
    expect(entries[0]).toMatchObject({ action: "keep", reason: "protected branch" });
  });

  it("warns about unpushed commits and still deletes", () => {
    const entry = plan((b) => (b === "lost" ? 3 : 0)).find((e) => e.branch === "lost");
    expect(entry).toMatchObject({ action: "delete", warning: "3 unpushed commit(s) will be lost" });
  });

  it("warns when the unpushed count is unknown and still deletes", () => {
    const entry = plan(() => null).find((e) => e.branch === "gone");
    expect(entry).toMatchObject({ action: "delete", warning: "could not count unpushed commits" });
  });

  it("adds no warning for a branch without unpushed commits", () => {
    expect(plan().find((e) => e.branch === "gone")?.warning).toBeUndefined();
  });
});

describe("planRemoteCleanup", () => {
  const prot = protectedBranches("work", "main");
  const pr = (number: number, state: PullRequestState["state"]): PullRequestState => ({ number, state });
  const table: Record<string, PullRequestState[] | null> = {
    merged: [pr(1, "MERGED")],
    closed: [pr(2, "CLOSED")],
    both: [pr(3, "CLOSED"), pr(4, "MERGED")],
    open: [pr(5, "OPEN")],
    reopened: [pr(6, "CLOSED"), pr(7, "OPEN")],
    never: [],
    broken: null,
  };
  const lookup = vi.fn((b: string) => (b in table ? table[b] : []));
  const entries = planRemoteCleanup(Object.keys(table).concat(["develop", "work"]), prot, "work", lookup);
  const by = (b: string): CleanupEntry => entries.find((e) => e.branch === b) as CleanupEntry;

  it("deletes a branch whose pull requests are all closed or merged", () => {
    expect(by("merged")).toMatchObject({ action: "delete", reason: "closed pull request #1" });
    expect(by("closed").action).toBe("delete");
    expect(by("both")).toMatchObject({ action: "delete", reason: "closed pull request #3, #4" });
  });

  it("keeps a branch with an open pull request, also next to a closed one", () => {
    expect(by("open")).toMatchObject({ action: "keep", reason: "open pull request #5" });
    expect(by("reopened")).toMatchObject({ action: "keep", reason: "open pull request #7" });
  });

  it("keeps a branch that never had a pull request", () => {
    expect(by("never")).toMatchObject({ action: "keep", reason: "no pull request" });
  });

  it("keeps a branch whose lookup failed and marks the failure", () => {
    expect(by("broken")).toMatchObject({ action: "keep", failed: true });
  });

  it("does not look up a protected branch", () => {
    expect(by("develop")).toMatchObject({ action: "keep", reason: "protected branch" });
    expect(by("work")).toMatchObject({ action: "keep", reason: "current branch" });
    expect(lookup).not.toHaveBeenCalledWith("develop");
    expect(lookup).not.toHaveBeenCalledWith("work");
  });
});

describe("formatEntry", () => {
  const entry: CleanupEntry = {
    scope: "local",
    branch: "feature/x",
    action: "delete",
    reason: "no origin branch",
    warning: "2 unpushed commit(s) will be lost",
  };

  it("says what would happen in a dry run", () => {
    expect(formatEntry(entry, true)).toContain("would delete");
  });

  it("names the action, scope, branch, reason and warning", () => {
    const line = formatEntry(entry, false);
    expect(line).toContain("delete");
    expect(line).toContain("local");
    expect(line).toContain("feature/x (no origin branch)");
    expect(line).toContain("[warning: 2 unpushed commit(s) will be lost]");
  });
});

describe("executeDeletions", () => {
  const entries: CleanupEntry[] = [
    { scope: "local", branch: "a", action: "delete", reason: "r" },
    { scope: "local", branch: "keep", action: "keep", reason: "r" },
    { scope: "remote", branch: "b", action: "delete", reason: "r" },
    { scope: "remote", branch: "c", action: "delete", reason: "r" },
  ];

  it("runs each deletion with its own deleter and carries on after a failure", () => {
    const local = vi.fn(() => ({ ok: true, stderr: "" }));
    const remote = vi.fn((b: string) => ({ ok: b !== "b", stderr: b === "b" ? "denied" : "" }));
    const outcomes = executeDeletions(entries, { local, remote });
    expect(local.mock.calls).toEqual([["a"]]);
    expect(remote.mock.calls).toEqual([["b"], ["c"]]);
    expect(outcomes.map((o) => [o.entry.branch, o.ok, o.message])).toEqual([
      ["a", true, ""],
      ["b", false, "denied"],
      ["c", true, ""],
    ]);
  });
});
