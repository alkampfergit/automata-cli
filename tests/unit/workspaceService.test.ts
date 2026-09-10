import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockHasUncommittedChanges = vi.fn();
const mockCheckoutBranch = vi.fn();
const mockCreateTrackingBranch = vi.fn();
const mockFetchBranch = vi.fn();
const mockPullFastForwardOnly = vi.fn();
const mockRevParse = vi.fn();
const mockIsAncestorCommit = vi.fn();
const mockResetHardTo = vi.fn();

// The git invocations live in gitService, which owns the process runner; this
// module only sequences them, so that is what the tests pin down.
vi.mock("../../src/git/gitService.js", () => ({
  hasUncommittedChanges: (...a: unknown[]) => mockHasUncommittedChanges(...a),
  checkoutBranch: (...a: unknown[]) => mockCheckoutBranch(...a),
  createTrackingBranch: (...a: unknown[]) => mockCreateTrackingBranch(...a),
  fetchBranch: (...a: unknown[]) => mockFetchBranch(...a),
  pullFastForwardOnly: (...a: unknown[]) => mockPullFastForwardOnly(...a),
  revParse: (...a: unknown[]) => mockRevParse(...a),
  isAncestorCommit: (...a: unknown[]) => mockIsAncestorCommit(...a),
  resetHardTo: (...a: unknown[]) => mockResetHardTo(...a),
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
  mockRevParse.mockReturnValue(null);
  mockIsAncestorCommit.mockReturnValue(false);
  mockResetHardTo.mockReturnValue(ok());
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

  it("excludes automata's own lock file from the cleanliness check", async () => {
    // The lock is created before this check runs, so in any repository that has
    // not gitignored it, it would otherwise read as an untracked change and
    // every item would be skipped as dirty-tree.
    const { prepareBaseBranch } = await import("../../src/git/workspaceService.js");
    prepareBaseBranch("develop");
    expect(mockHasUncommittedChanges).toHaveBeenCalledWith([".automata/automata.lock"]);
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

  it("reports a diverged head branch as a pull failure when local commits are at risk", async () => {
    mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
    // The local tip is not reachable from where the remote was, so it holds a
    // commit this checkout made and never pushed. Nothing may be discarded.
    mockRevParse.mockReturnValue("aaa");
    mockIsAncestorCommit.mockReturnValue(false);
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toMatchObject({
      ok: false,
      reason: "pull-failed",
      detail: expect.stringContaining("reset --hard origin/feature/042"),
    });
    expect(mockResetHardTo).not.toHaveBeenCalled();
  });

  it("reads the remote-tracking ref before the fetch overwrites it", async () => {
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    preparePrBranch("dependabot/npm_and_yarn/left-pad-1.3.0");
    // Order matters: the forced fetch moves this ref, so afterwards there is no
    // way to learn where the remote was.
    expect(mockRevParse.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetchBranch.mock.invocationCallOrder[0],
    );
    expect(mockRevParse).toHaveBeenCalledWith("refs/remotes/origin/dependabot/npm_and_yarn/left-pad-1.3.0");
  });

  it("resets a force-pushed head branch that holds nothing this checkout made", async () => {
    // The Dependabot rebase case: the local tip is exactly what the remote said
    // last time, so every commit on it came from the remote and was rewritten
    // there. Without this the branch can never be fast-forwarded again.
    mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
    mockRevParse.mockImplementation((ref: string) =>
      ref === "refs/remotes/origin/dependabot/bump" ? "old" : "old",
    );
    mockIsAncestorCommit.mockReturnValue(true);
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("dependabot/bump")).toEqual({ ok: true, branch: "dependabot/bump" });
    expect(mockIsAncestorCommit).toHaveBeenCalledWith("old", "old");
    expect(mockResetHardTo).toHaveBeenCalledWith("refs/remotes/origin/dependabot/bump");
  });

  // Distinct shas on purpose: the canonical Dependabot case has both refs at the
  // same commit, which makes `toHaveBeenCalledWith("old", "old")` above true
  // whichever way round the arguments go. The precondition is directional — it
  // must be "the local tip is contained in the remote as last seen", never the
  // reverse — so one case has to pin the order from the safe side too.
  it("resets when the local tip is a strict ancestor of the remote tip last seen", async () => {
    mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
    mockRevParse.mockImplementation((ref: string) =>
      ref === "refs/remotes/origin/dependabot/bump" ? "prev-remote-tip" : "local-behind",
    );
    mockIsAncestorCommit.mockReturnValue(true);
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("dependabot/bump")).toEqual({ ok: true, branch: "dependabot/bump" });
    expect(mockIsAncestorCommit).toHaveBeenCalledWith("local-behind", "prev-remote-tip");
    expect(mockResetHardTo).toHaveBeenCalledWith("refs/remotes/origin/dependabot/bump");
  });

  it("keeps a local branch whose tip the remote never had", async () => {
    mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
    mockRevParse.mockImplementation((ref: string) =>
      ref === "refs/remotes/origin/dependabot/bump" ? "old" : "unpushed",
    );
    mockIsAncestorCommit.mockReturnValue(false);
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("dependabot/bump")).toMatchObject({ ok: false, reason: "pull-failed" });
    expect(mockIsAncestorCommit).toHaveBeenCalledWith("unpushed", "old");
    expect(mockResetHardTo).not.toHaveBeenCalled();
  });

  it("refuses rather than resetting when the remote-tracking ref was unknown", async () => {
    // Nothing to compare the local tip against, so nothing can be proved
    // disposable — the local branch may hold work made on this checkout.
    mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
    mockRevParse.mockImplementation((ref: string) =>
      ref === "refs/remotes/origin/dependabot/bump" ? null : "local",
    );
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("dependabot/bump")).toMatchObject({ ok: false, reason: "pull-failed" });
    expect(mockIsAncestorCommit).not.toHaveBeenCalled();
    expect(mockResetHardTo).not.toHaveBeenCalled();
  });

  it("reports a failed reset as a pull failure", async () => {
    mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
    mockRevParse.mockReturnValue("old");
    mockIsAncestorCommit.mockReturnValue(true);
    mockResetHardTo.mockReturnValue(fail("fatal: could not reset index"));
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("dependabot/bump")).toEqual({
      ok: false,
      reason: "pull-failed",
      detail: "fatal: could not reset index",
    });
  });
});
