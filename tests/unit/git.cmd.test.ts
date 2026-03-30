import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";

// ── CLI smoke tests (run against built dist) ──────────────────────────────────

describe("automata git (CLI smoke)", () => {
  it("shows help for git command", () => {
    const output = execSync("node dist/index.js git --help", { encoding: "utf8" });
    expect(output).toContain("get-pr-info");
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

  it("returns PrInfo when gh returns valid JSON", async () => {
    const pr = { number: 42, title: "Fix bug", state: "MERGED", url: "https://github.com/org/repo/pull/42" };
    mockSpawnSync.mockReturnValue({ stdout: JSON.stringify(pr), stderr: "", status: 0 });
    const { getPrInfo } = await import("../../src/git/gitService.js");
    expect(getPrInfo("my-branch")).toEqual(pr);
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
