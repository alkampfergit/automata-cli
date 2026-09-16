import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockHasUncommittedChanges = vi.fn();
const mockCheckoutBranch = vi.fn();
const mockCreateTrackingBranch = vi.fn();
const mockFetchBranch = vi.fn();
const mockPullFastForwardOnly = vi.fn();
const mockRevParse = vi.fn();
const mockIsAncestorCommit = vi.fn();
const mockResetHardTo = vi.fn();
const mockDescribeDivergence = vi.fn();
const mockRebaseOnto = vi.fn();
const mockAbortRebase = vi.fn();
const mockIsRebaseInProgress = vi.fn();

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
  describeDivergence: (...a: unknown[]) => mockDescribeDivergence(...a),
  rebaseOnto: (...a: unknown[]) => mockRebaseOnto(...a),
  abortRebase: (...a: unknown[]) => mockAbortRebase(...a),
  isRebaseInProgress: (...a: unknown[]) => mockIsRebaseInProgress(...a),
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
  // Null is "nothing could be established", which is the answer that makes
  // every pre-existing refusal test still take the refusal path.
  mockDescribeDivergence.mockReturnValue(null);
  mockRebaseOnto.mockReturnValue(ok());
  mockAbortRebase.mockReturnValue(ok());
  // A failing `git rebase` that left state behind is the conflict case; the
  // tests that exercise a refusal before the replay set this to false.
  mockIsRebaseInProgress.mockReturnValue(true);
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
    expect(prepareBaseBranch("develop")).toEqual({
      ok: true,
      branch: "develop",
      strategy: "fast-forward",
    });
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
    expect(preparePrBranch("feature/042")).toEqual({
      ok: true,
      branch: "feature/042",
      strategy: "fast-forward",
    });
    expect(mockFetchBranch).toHaveBeenCalledWith("feature/042");
    expect(mockCheckoutBranch).toHaveBeenCalledWith("feature/042");
    expect(mockPullFastForwardOnly).toHaveBeenCalledWith("feature/042");
    expect(mockCreateTrackingBranch).not.toHaveBeenCalled();
  });

  it("creates the local tracking branch when this checkout has never seen it", async () => {
    mockCheckoutBranch.mockReturnValue(fail("error: pathspec 'feature/042' did not match"));
    const { preparePrBranch } = await import("../../src/git/workspaceService.js");
    expect(preparePrBranch("feature/042")).toEqual({
      ok: true,
      branch: "feature/042",
      strategy: "tracking-branch",
    });
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
    expect(preparePrBranch("dependabot/bump")).toEqual({
      ok: true,
      branch: "dependabot/bump",
      strategy: "reset-to-remote",
    });
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
    expect(preparePrBranch("dependabot/bump")).toEqual({
      ok: true,
      branch: "dependabot/bump",
      strategy: "reset-to-remote",
    });
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

  describe("the already-applied divergence", () => {
    // The reported case in issue #73: the local tip and the remote tip are
    // different commits with the same parent and the same tree, because the
    // change reached the remote under another sha. Neither `--ff-only` nor the
    // force-push reset can act on it, so before this the item was skipped on
    // every tick forever.
    function divergedWithAllCommitsUpstream(): void {
      mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
      mockRevParse.mockReturnValue(null);
      mockDescribeDivergence.mockReturnValue({
        commits: [{ sha: "32d7a0c", alreadyUpstream: true }],
        merges: 0,
      });
    }

    it("rebases onto the remote when every local-only commit is already upstream", async () => {
      divergedWithAllCommitsUpstream();
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      expect(preparePrBranch("copilot/trusted-publishing")).toEqual({
        ok: true,
        branch: "copilot/trusted-publishing",
        strategy: "rebase",
      });
      expect(mockDescribeDivergence).toHaveBeenCalledWith(
        "refs/remotes/origin/copilot/trusted-publishing",
        "refs/heads/copilot/trusted-publishing",
      );
      // The already-fetched remote-tracking ref, not a second `git pull`: the
      // strategy must not be re-interpretable by the machine's git config.
      expect(mockRebaseOnto).toHaveBeenCalledWith("refs/remotes/origin/copilot/trusted-publishing");
      expect(mockResetHardTo).not.toHaveBeenCalled();
    });

    it("never looks at the divergence when the fast-forward succeeded", async () => {
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      preparePrBranch("feature/042");
      expect(mockDescribeDivergence).not.toHaveBeenCalled();
      expect(mockRebaseOnto).not.toHaveBeenCalled();
    });

    it("refuses when even one local-only commit is not upstream", async () => {
      mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
      mockRevParse.mockReturnValue(null);
      mockDescribeDivergence.mockReturnValue({
        commits: [
          { sha: "32d7a0c", alreadyUpstream: true },
          { sha: "ffffff1", alreadyUpstream: false },
        ],
        merges: 0,
      });
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      expect(preparePrBranch("feature/042")).toMatchObject({
        ok: false,
        reason: "pull-failed",
        detail: expect.stringContaining("1 of its commits is not on origin/feature/042"),
      });
      expect(mockRebaseOnto).not.toHaveBeenCalled();
      expect(mockResetHardTo).not.toHaveBeenCalled();
    });

    it("counts more than one unpushed commit in the plural", async () => {
      // The singular and the plural are separate branches of the message, and
      // an operator reads this line out of cron mail.
      mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
      mockRevParse.mockReturnValue(null);
      mockDescribeDivergence.mockReturnValue({
        commits: [
          { sha: "ffffff1", alreadyUpstream: false },
          { sha: "ffffff2", alreadyUpstream: false },
        ],
        merges: 0,
      });
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      expect(preparePrBranch("feature/042")).toMatchObject({
        detail: expect.stringContaining("2 of its commits are not on origin/feature/042"),
      });
    });

    it("does not call a pull that failed with nothing local-only a divergence", async () => {
      // A fast-forward can fail on a branch that is merely behind — a stale
      // `index.lock`, a ref this process cannot write, a hook that rejected the
      // pull. The old message named a divergence and offered `git reset --hard`
      // as its remedy, both of which are wrong for git's own error.
      mockPullFastForwardOnly.mockReturnValue(
        fail("fatal: Unable to create '.git/index.lock': File exists."),
      );
      mockRevParse.mockReturnValue(null);
      mockDescribeDivergence.mockReturnValue({ commits: [], merges: 0 });
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      const result = preparePrBranch("feature/042");
      expect(result).toMatchObject({ ok: false, reason: "pull-failed" });
      const detail = (result as { detail: string }).detail;
      expect(detail).toContain(
        "no commit of the local feature/042 is missing from origin/feature/042",
      );
      expect(detail).toContain("feature/042 is untouched");
      expect(detail).not.toContain("0 of its commits");
      expect(detail).not.toContain("has diverged");
      expect(detail).not.toContain("git reset --hard");
      expect(mockRebaseOnto).not.toHaveBeenCalled();
      expect(mockResetHardTo).not.toHaveBeenCalled();
    });

    it("refuses when the range holds a merge commit", async () => {
      // `git cherry` cannot compute a patch-id for a merge and omits it, so a
      // listing that looks entirely already-upstream can still be hiding work.
      mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
      mockRevParse.mockReturnValue(null);
      mockDescribeDivergence.mockReturnValue({
        commits: [{ sha: "32d7a0c", alreadyUpstream: true }],
        merges: 1,
      });
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      expect(preparePrBranch("feature/042")).toMatchObject({ ok: false, reason: "pull-failed" });
      expect(mockRebaseOnto).not.toHaveBeenCalled();
    });

    it("refuses when the divergence could not be read at all", async () => {
      mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
      mockRevParse.mockReturnValue(null);
      mockDescribeDivergence.mockReturnValue(null);
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      expect(preparePrBranch("feature/042")).toMatchObject({
        ok: false,
        reason: "pull-failed",
        detail: expect.stringContaining("could not be listed"),
      });
      expect(mockRebaseOnto).not.toHaveBeenCalled();
    });

    it("refuses when there is no local-only commit to explain the divergence", async () => {
      mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
      mockRevParse.mockReturnValue(null);
      mockDescribeDivergence.mockReturnValue({ commits: [], merges: 0 });
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      expect(preparePrBranch("feature/042")).toMatchObject({ ok: false, reason: "pull-failed" });
      expect(mockRebaseOnto).not.toHaveBeenCalled();
    });

    it("aborts a conflicting rebase and reports it under its own reason", async () => {
      // Leaving the rebase in progress would make the next tick see a conflicted
      // index — a dirty tree — and refuse every item, not just this one.
      divergedWithAllCommitsUpstream();
      mockRebaseOnto.mockReturnValue(fail("CONFLICT (content): Merge conflict in f.txt"));
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      expect(preparePrBranch("feature/042")).toEqual({
        ok: false,
        reason: "rebase-conflict",
        detail:
          "CONFLICT (content): Merge conflict in f.txt — the rebase was aborted, so feature/042 is back where it was",
      });
      expect(mockAbortRebase).toHaveBeenCalledWith();
    });

    it("reports a rebase git refused to start as pull-failed, not a conflict", async () => {
      // A pre-rebase hook, a locked ref, an unreadable upstream: git exits
      // non-zero without halting mid-replay. There is no conflict to resolve
      // and nothing to abort, and saying "rebase-conflict" would send the
      // operator looking for one.
      divergedWithAllCommitsUpstream();
      mockRebaseOnto.mockReturnValue(fail("error: cannot lock ref 'refs/heads/feature/042'"));
      mockIsRebaseInProgress.mockReturnValue(false);
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      expect(preparePrBranch("feature/042")).toEqual({
        ok: false,
        reason: "pull-failed",
        detail:
          "error: cannot lock ref 'refs/heads/feature/042' — the rebase never started, so feature/042 is untouched",
      });
      expect(mockAbortRebase).not.toHaveBeenCalled();
    });

    it("says so when even the abort failed", async () => {
      divergedWithAllCommitsUpstream();
      mockRebaseOnto.mockReturnValue(fail("CONFLICT"));
      mockAbortRebase.mockReturnValue(fail("fatal: no rebase in progress"));
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      expect(preparePrBranch("feature/042")).toMatchObject({
        ok: false,
        reason: "rebase-conflict",
        detail: expect.stringContaining("git rebase --abort"),
      });
    });

    it("prefers the force-push reset over the rebase when both would apply", async () => {
      // The reset rests on reachability, which is stronger evidence than patch
      // equivalence, and it is the path that already shipped.
      mockPullFastForwardOnly.mockReturnValue(fail("fatal: Not possible to fast-forward"));
      mockRevParse.mockReturnValue("old");
      mockIsAncestorCommit.mockReturnValue(true);
      mockDescribeDivergence.mockReturnValue({
        commits: [{ sha: "32d7a0c", alreadyUpstream: true }],
        merges: 0,
      });
      const { preparePrBranch } = await import("../../src/git/workspaceService.js");
      expect(preparePrBranch("dependabot/bump")).toMatchObject({ strategy: "reset-to-remote" });
      expect(mockRebaseOnto).not.toHaveBeenCalled();
    });
  });
});
