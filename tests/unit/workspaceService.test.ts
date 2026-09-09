import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSpawnSync = vi.fn();
const mockHasUncommittedChanges = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: (...args: unknown[]) => mockSpawnSync(...args) };
});

vi.mock("../../src/git/gitService.js", () => ({
  hasUncommittedChanges: () => mockHasUncommittedChanges(),
}));

function ok(stdout = ""): { stdout: string; stderr: string; status: number } {
  return { stdout, stderr: "", status: 0 };
}

function fail(stderr: string): { stdout: string; stderr: string; status: number } {
  return { stdout: "", stderr, status: 1 };
}

function gitArgs(): string[][] {
  return mockSpawnSync.mock.calls.map((call) => call[1] as string[]);
}

beforeEach(() => {
  mockSpawnSync.mockReset();
  mockHasUncommittedChanges.mockReset();
  mockHasUncommittedChanges.mockReturnValue(false);
});

afterEach(() => {
  vi.resetModules();
});

describe("prepareBaseBranch", () => {
  it("refuses a dirty tree before running any git command", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    const { prepareBaseBranch } = await import("../../src/git/workspaceService.js");
    const result = prepareBaseBranch("develop");
    expect(result).toEqual({
      ok: false,
      reason: "dirty-tree",
      detail: expect.stringContaining("uncommitted changes"),
    });
    // The critical part: nothing was mutated, so no human work can be lost.
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("checks out the base branch and fast-forwards it", async () => {
    mockSpawnSync.mockReturnValue(ok());
    const { prepareBaseBranch } = await import("../../src/git/workspaceService.js");
    expect(prepareBaseBranch("develop")).toEqual({ ok: true, branch: "develop" });
    expect(gitArgs()).toEqual([["checkout", "develop"], ["pull", "--ff-only"]]);
  });

  it("reports a checkout failure", async () => {
    mockSpawnSync.mockReturnValueOnce(fail("error: pathspec 'develop' did not match"));
    const { prepareBaseBranch } = await import("../../src/git/workspaceService.js");
    expect(prepareBaseBranch("develop")).toEqual({
      ok: false,
      reason: "checkout-failed",
      detail: "error: pathspec 'develop' did not match",
    });
  });

  it("reports a diverged branch as a pull failure instead of merging it", async () => {
    mockSpawnSync.mockReturnValueOnce(ok()).mockReturnValueOnce(fail("fatal: Not possible to fast-forward"));
    const { prepareBaseBranch } = await import("../../src/git/workspaceService.js");
    expect(prepareBaseBranch("develop")).toEqual({
      ok: false,
      reason: "pull-failed",
      detail: "fatal: Not possible to fast-forward",
    });
  });
});

describe("preparePrBranch", () => {
  it("refuses a dirty tree before running any git command", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toMatchObject({ ok: false, reason: "dirty-tree" });
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("fetches, checks out and fast-forwards an existing local branch", async () => {
    mockSpawnSync.mockReturnValue(ok());
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toEqual({ ok: true, branch: "feature/042" });
    expect(gitArgs()).toEqual([
      ["fetch", "origin", "feature/042"],
      ["checkout", "feature/042"],
      ["pull", "--ff-only", "origin", "feature/042"],
    ]);
  });

  it("creates the local tracking branch when this checkout has never seen it", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok())
      .mockReturnValueOnce(fail("error: pathspec 'feature/042' did not match"))
      .mockReturnValueOnce(ok());
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toEqual({ ok: true, branch: "feature/042" });
    expect(gitArgs()[2]).toEqual(["checkout", "-b", "feature/042", "origin/feature/042"]);
  });

  it("reports a failure to create the branch", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok())
      .mockReturnValueOnce(fail("no local branch"))
      .mockReturnValueOnce(fail("fatal: 'origin/feature/042' is not a commit"));
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toEqual({
      ok: false,
      reason: "checkout-failed",
      detail: "fatal: 'origin/feature/042' is not a commit",
    });
  });

  it("reports a fetch failure", async () => {
    mockSpawnSync.mockReturnValueOnce(fail("fatal: couldn't find remote ref"));
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toMatchObject({ ok: false, reason: "checkout-failed" });
  });

  it("reports a diverged head branch as a pull failure", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok())
      .mockReturnValueOnce(ok())
      .mockReturnValueOnce(fail("fatal: Not possible to fast-forward"));
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toMatchObject({ ok: false, reason: "pull-failed" });
  });
});
