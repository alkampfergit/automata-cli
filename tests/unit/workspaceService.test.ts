import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockHasUncommittedChanges = vi.fn();
const mockCheckoutBranch = vi.fn();
const mockCreateTrackingBranch = vi.fn();
const mockFetchBranch = vi.fn();
const mockPullFastForwardOnly = vi.fn();

// The git invocations live in gitService, which owns the process runner; this
// module only sequences them, so that is what the tests pin down.
vi.mock("../../src/git/gitService.js", () => ({
  hasUncommittedChanges: () => mockHasUncommittedChanges(),
  checkoutBranch: (...a: unknown[]) => mockCheckoutBranch(...a),
  createTrackingBranch: (...a: unknown[]) => mockCreateTrackingBranch(...a),
  fetchBranch: (...a: unknown[]) => mockFetchBranch(...a),
  pullFastForwardOnly: (...a: unknown[]) => mockPullFastForwardOnly(...a),
}));

function ok(): { ok: boolean; stderr: string } {
  return { ok: true, stderr: "" };
}

function fail(stderr: string): { ok: boolean; stderr: string } {
  return { ok: false, stderr };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasUncommittedChanges.mockReturnValue(false);
  mockCheckoutBranch.mockReturnValue(ok());
  mockCreateTrackingBranch.mockReturnValue(ok());
  mockFetchBranch.mockReturnValue(ok());
  mockPullFastForwardOnly.mockReturnValue(ok());
});

afterEach(() => {
  vi.resetModules();
});

describe("prepareBaseBranch", () => {
  it("refuses a dirty tree before running any git command", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    const { prepareBaseBranch } = await import("../../src/git/workspaceService.js");
    expect(prepareBaseBranch("develop")).toEqual({
      ok: false,
      reason: "dirty-tree",
      detail: expect.stringContaining("uncommitted changes"),
    });
    // The critical part: nothing was mutated, so no human work can be lost.
    expect(mockCheckoutBranch).not.toHaveBeenCalled();
    expect(mockPullFastForwardOnly).not.toHaveBeenCalled();
  });

  it("checks out the base branch and fast-forwards it", async () => {
    const { prepareBaseBranch } = await import("../../src/git/workspaceService.js");
    expect(prepareBaseBranch("develop")).toEqual({ ok: true, branch: "develop" });
    expect(mockCheckoutBranch).toHaveBeenCalledWith("develop");
    expect(mockPullFastForwardOnly).toHaveBeenCalledWith();
  });

  it("reports a checkout failure", async () => {
    mockCheckoutBranch.mockReturnValue(fail("error: pathspec 'develop' did not match"));
    const { prepareBaseBranch } = await import("../../src/git/workspaceService.js");
    expect(prepareBaseBranch("develop")).toEqual({
      ok: false,
      reason: "checkout-failed",
      detail: "error: pathspec 'develop' did not match",
    });
    expect(mockPullFastForwardOnly).not.toHaveBeenCalled();
  });

  it("reports a diverged branch as a pull failure instead of merging it", async () => {
    mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
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
    expect(mockFetchBranch).not.toHaveBeenCalled();
    expect(mockCheckoutBranch).not.toHaveBeenCalled();
  });

  it("fetches, checks out and fast-forwards an existing local branch", async () => {
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toEqual({ ok: true, branch: "feature/042" });
    expect(mockFetchBranch).toHaveBeenCalledWith("feature/042");
    expect(mockCheckoutBranch).toHaveBeenCalledWith("feature/042");
    expect(mockPullFastForwardOnly).toHaveBeenCalledWith("feature/042");
    expect(mockCreateTrackingBranch).not.toHaveBeenCalled();
  });

  it("creates the local tracking branch when this checkout has never seen it", async () => {
    mockCheckoutBranch.mockReturnValue(fail("error: pathspec 'feature/042' did not match"));
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toEqual({ ok: true, branch: "feature/042" });
    expect(mockCreateTrackingBranch).toHaveBeenCalledWith("feature/042");
    // A freshly created tracking branch is already at the remote tip.
    expect(mockPullFastForwardOnly).not.toHaveBeenCalled();
  });

  it("reports a failure to create the branch", async () => {
    mockCheckoutBranch.mockReturnValue(fail("no local branch"));
    mockCreateTrackingBranch.mockReturnValue(fail("fatal: 'origin/feature/042' is not a commit"));
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toEqual({
      ok: false,
      reason: "checkout-failed",
      detail: "fatal: 'origin/feature/042' is not a commit",
    });
  });

  it("reports a fetch failure without attempting a checkout", async () => {
    mockFetchBranch.mockReturnValue(fail("fatal: couldn't find remote ref"));
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toMatchObject({ ok: false, reason: "checkout-failed" });
    expect(mockCheckoutBranch).not.toHaveBeenCalled();
  });

  it("reports a diverged head branch as a pull failure", async () => {
    mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toMatchObject({ ok: false, reason: "pull-failed" });
  });
});
