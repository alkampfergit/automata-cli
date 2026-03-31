import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";

// ── CLI smoke tests (run against built dist) ──────────────────────────────────

describe("automata git (CLI smoke)", () => {
  it("shows help for git command", () => {
    const output = execSync("node dist/index.js git --help", { encoding: "utf8" });
    expect(output).toContain("get-pr-info");
    expect(output).toContain("get-pr-comments");
    expect(output).toContain("finish-feature");
  });

  it("shows help for get-pr-info", () => {
    const output = execSync("node dist/index.js git get-pr-info --help", { encoding: "utf8" });
    expect(output).toContain("--json");
  });

  it("shows help for finish-feature", () => {
    const output = execSync("node dist/index.js git finish-feature --help", { encoding: "utf8" });
    expect(output).toContain("finish-feature");
  });
});

// ── Unit tests for gitService ─────────────────────────────────────────────────

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  };
});

describe("gitService.getCurrentBranch", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns the trimmed branch name on success", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "feature/my-branch\n", stderr: "", status: 0 });
    const { getCurrentBranch } = await import("../../src/git/gitService.js");
    expect(getCurrentBranch()).toBe("feature/my-branch");
  });

  it("throws when git rev-parse fails", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "fatal: not a git repo", status: 128 });
    const { getCurrentBranch } = await import("../../src/git/gitService.js");
    expect(() => getCurrentBranch()).toThrow("Failed to determine current branch");
  });
});

describe("gitService.getPrInfo", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns PrInfo with empty checks when gh returns no statusCheckRollup", async () => {
    const raw = { number: 42, title: "Fix bug", state: "MERGED", url: "https://github.com/org/repo/pull/42", statusCheckRollup: null };
    mockSpawnSync.mockReturnValue({ stdout: JSON.stringify(raw), stderr: "", status: 0 });
    const { getPrInfo } = await import("../../src/git/gitService.js");
    expect(getPrInfo("my-branch")).toEqual({ number: 42, title: "Fix bug", state: "MERGED", url: "https://github.com/org/repo/pull/42", checks: [] });
  });

  it("returns PrInfo with mapped checks when gh returns statusCheckRollup", async () => {
    const raw = {
      number: 42, title: "Fix bug", state: "MERGED", url: "https://github.com/org/repo/pull/42",
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "https://example.com" },
        { name: "test", status: "COMPLETED", conclusion: "FAILURE", description: "3 tests failed", detailsUrl: "https://example.com/2" },
      ],
    };
    mockSpawnSync.mockReturnValue({ stdout: JSON.stringify(raw), stderr: "", status: 0 });
    const { getPrInfo } = await import("../../src/git/gitService.js");
    const result = getPrInfo("my-branch");
    expect(result?.checks).toHaveLength(2);
    expect(result?.checks[0]).toEqual({ name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "https://example.com" });
    expect(result?.checks[1]).toEqual({ name: "test", status: "COMPLETED", conclusion: "FAILURE", description: "3 tests failed", detailsUrl: "https://example.com/2" });
  });

  it("returns null when no PR is found", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "no pull requests found", status: 1 });
    const { getPrInfo } = await import("../../src/git/gitService.js");
    expect(getPrInfo("my-branch")).toBeNull();
  });

  it("throws when gh is not authenticated", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "To authenticate, please run: gh auth login", status: 1 });
    const { getPrInfo } = await import("../../src/git/gitService.js");
    expect(() => getPrInfo("my-branch")).toThrow("gh auth login");
  });
});

describe("gitService.isUpstreamGone", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns true when ls-remote exits with non-zero (ref not found)", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 2 });
    const { isUpstreamGone } = await import("../../src/git/gitService.js");
    expect(isUpstreamGone("my-branch")).toBe(true);
  });

  it("returns false when ls-remote exits with 0 (ref exists)", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "abc123\trefs/heads/my-branch\n", stderr: "", status: 0 });
    const { isUpstreamGone } = await import("../../src/git/gitService.js");
    expect(isUpstreamGone("my-branch")).toBe(false);
  });
});

describe("gitService.hasUncommittedChanges", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns true when git status --porcelain has output", async () => {
    mockSpawnSync.mockReturnValue({ stdout: " M src/index.ts\n", stderr: "", status: 0 });
    const { hasUncommittedChanges } = await import("../../src/git/gitService.js");
    expect(hasUncommittedChanges()).toBe(true);
  });

  it("returns false when working tree is clean", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });
    const { hasUncommittedChanges } = await import("../../src/git/gitService.js");
    expect(hasUncommittedChanges()).toBe(false);
  });
});

describe("gitService.getPrComments", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns unsupported when remoteType is azdo", async () => {
    vi.doMock("../../src/config/configStore.js", () => ({
      readConfig: () => ({ remoteType: "azdo" }),
    }));
    const { getPrComments } = await import("../../src/git/gitService.js");
    expect(getPrComments("my-branch")).toBe("unsupported");
  });

  it("returns array of PrComments for unresolved threads", async () => {
    vi.doMock("../../src/config/configStore.js", () => ({
      readConfig: () => ({ remoteType: "gh" }),
    }));
    const gqlResponse = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: false,
                  isOutdated: false,
                  comments: { nodes: [{ author: { login: "alice" }, body: "Fix this", path: "src/foo.ts", line: 10, createdAt: "2026-03-30T10:00:00Z" }] },
                },
                {
                  isResolved: true,
                  isOutdated: false,
                  comments: { nodes: [{ author: { login: "bob" }, body: "Already resolved", path: "src/bar.ts", line: 5, createdAt: "2026-03-30T09:00:00Z" }] },
                },
              ],
            },
          },
        },
      },
    };
    // call 1: gh pr view --json number
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify({ number: 42 }), stderr: "", status: 0 });
    // call 2: git remote get-url origin (parseOwnerRepo)
    mockSpawnSync.mockReturnValueOnce({ stdout: "https://github.com/org/repo.git\n", stderr: "", status: 0 });
    // call 3: gh api graphql
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(gqlResponse), stderr: "", status: 0 });
    const { getPrComments } = await import("../../src/git/gitService.js");
    const result = getPrComments("my-branch");
    expect(result).toHaveLength(1);
    expect(result).toEqual([
      { author: "alice", body: "Fix this", path: "src/foo.ts", line: 10, createdAt: "2026-03-30T10:00:00Z" },
    ]);
  });

  it("returns empty array when all threads are resolved", async () => {
    vi.doMock("../../src/config/configStore.js", () => ({
      readConfig: () => ({ remoteType: "gh" }),
    }));
    const gqlResponse = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: true,
                  isOutdated: false,
                  comments: { nodes: [{ author: { login: "alice" }, body: "Done", path: "src/foo.ts", line: 1, createdAt: "2026-03-30T10:00:00Z" }] },
                },
              ],
            },
          },
        },
      },
    };
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify({ number: 42 }), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "https://github.com/org/repo.git\n", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(gqlResponse), stderr: "", status: 0 });
    const { getPrComments } = await import("../../src/git/gitService.js");
    expect(getPrComments("my-branch")).toEqual([]);
  });

  it("returns null when no PR found", async () => {
    vi.doMock("../../src/config/configStore.js", () => ({
      readConfig: () => ({ remoteType: "gh" }),
    }));
    // call 1: gh pr view --json number fails with "no pull requests found"
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "no pull requests found", status: 1 });
    const { getPrComments } = await import("../../src/git/gitService.js");
    expect(getPrComments("my-branch")).toBeNull();
  });

  it("sets line to null for file-level comments", async () => {
    vi.doMock("../../src/config/configStore.js", () => ({
      readConfig: () => ({ remoteType: "gh" }),
    }));
    const gqlResponse = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: false,
                  isOutdated: false,
                  comments: { nodes: [{ author: { login: "bob" }, body: "Missing header", path: "src/bar.ts", line: null, createdAt: "2026-03-30T11:00:00Z" }] },
                },
              ],
            },
          },
        },
      },
    };
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify({ number: 42 }), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "https://github.com/org/repo.git\n", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(gqlResponse), stderr: "", status: 0 });
    const { getPrComments } = await import("../../src/git/gitService.js");
    const result = getPrComments("my-branch");
    expect(result).toEqual([
      { author: "bob", body: "Missing header", path: "src/bar.ts", line: null, createdAt: "2026-03-30T11:00:00Z" },
    ]);
  });
});
