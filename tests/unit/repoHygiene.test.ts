import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// gitService and ghWorkService own the process runners; this module only
// sequences them and decides, so that is exactly what these tests pin down.
const mockHasUncommittedChanges = vi.fn();
const mockGetCurrentBranch = vi.fn();
const mockListLocalBranches = vi.fn();
const mockListRemoteBranches = vi.fn();
const mockCountCommitsNotIn = vi.fn();
const mockCreateBranchAtHead = vi.fn();
const mockStageAllExcept = vi.fn();
const mockCommitStaged = vi.fn();
const mockPushSetUpstream = vi.fn();
const mockCheckoutBranch = vi.fn();
const mockPullFastForwardOnly = vi.fn();
const mockForceDeleteLocalBranch = vi.fn();
const mockListPullRequestsForHead = vi.fn();
const mockCreateDraftPullRequest = vi.fn();

vi.mock("../../src/git/gitService.js", () => ({
  hasUncommittedChanges: (...a: unknown[]) => mockHasUncommittedChanges(...a),
  getCurrentBranch: (...a: unknown[]) => mockGetCurrentBranch(...a),
  listLocalBranches: (...a: unknown[]) => mockListLocalBranches(...a),
  listRemoteBranches: (...a: unknown[]) => mockListRemoteBranches(...a),
  countCommitsNotIn: (...a: unknown[]) => mockCountCommitsNotIn(...a),
  createBranchAtHead: (...a: unknown[]) => mockCreateBranchAtHead(...a),
  stageAllExcept: (...a: unknown[]) => mockStageAllExcept(...a),
  commitStaged: (...a: unknown[]) => mockCommitStaged(...a),
  pushSetUpstream: (...a: unknown[]) => mockPushSetUpstream(...a),
  checkoutBranch: (...a: unknown[]) => mockCheckoutBranch(...a),
  pullFastForwardOnly: (...a: unknown[]) => mockPullFastForwardOnly(...a),
  forceDeleteLocalBranch: (...a: unknown[]) => mockForceDeleteLocalBranch(...a),
}));

vi.mock("../../src/github/ghWorkService.js", () => ({
  listPullRequestsForHead: (...a: unknown[]) => mockListPullRequestsForHead(...a),
  createDraftPullRequest: (...a: unknown[]) => mockCreateDraftPullRequest(...a),
}));

function ok(): { ok: boolean; stderr: string } {
  return { ok: true, stderr: "" };
}

function bad(stderr: string): { ok: boolean; stderr: string } {
  return { ok: false, stderr };
}

/** Every call that changes the repository or GitHub. A dry run may issue none. */
const MUTATORS = [
  mockCreateBranchAtHead,
  mockStageAllExcept,
  mockCommitStaged,
  mockPushSetUpstream,
  mockCheckoutBranch,
  mockPullFastForwardOnly,
  mockForceDeleteLocalBranch,
  mockCreateDraftPullRequest,
];

function expectNothingMutated(): void {
  for (const mutator of MUTATORS) expect(mutator).not.toHaveBeenCalled();
}

const NOW = new Date("2026-09-10T05:45:12.345Z");

const logged: string[] = [];

function options(overrides: Record<string, unknown> = {}): {
  baseBranch: string;
  protectedBranches: string[];
  dryRun: boolean;
  log: (message: string) => void;
} {
  return {
    baseBranch: "develop",
    protectedBranches: ["master", "develop"],
    dryRun: false,
    log: (message: string) => logged.push(message),
    ...overrides,
  };
}

async function hygiene(): Promise<typeof import("../../src/git/repoHygiene.js")> {
  return import("../../src/git/repoHygiene.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  logged.length = 0;
  mockHasUncommittedChanges.mockReturnValue(false);
  mockGetCurrentBranch.mockReturnValue("develop");
  mockListLocalBranches.mockReturnValue(["develop"]);
  mockListRemoteBranches.mockReturnValue(["develop"]);
  mockCountCommitsNotIn.mockReturnValue(0);
  mockCreateBranchAtHead.mockReturnValue(ok());
  mockStageAllExcept.mockReturnValue(ok());
  mockCommitStaged.mockReturnValue(ok());
  mockPushSetUpstream.mockReturnValue(ok());
  mockCheckoutBranch.mockReturnValue(ok());
  mockPullFastForwardOnly.mockReturnValue(ok());
  mockForceDeleteLocalBranch.mockReturnValue(ok());
  mockListPullRequestsForHead.mockReturnValue([]);
  mockCreateDraftPullRequest.mockReturnValue({ number: 99, url: "https://gh/pr/99" });
});

afterEach(() => {
  vi.resetModules();
});

// ── Step 1: rescue uncommitted changes (US1) ─────────────────────────────────

describe("rescue", () => {
  it("does nothing when the working tree is clean", async () => {
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(report.rescue).toEqual({ kind: "clean" });
    expect(mockCreateBranchAtHead).not.toHaveBeenCalled();
    expect(mockCommitStaged).not.toHaveBeenCalled();
    expect(mockPushSetUpstream).not.toHaveBeenCalled();
    expect(mockCreateDraftPullRequest).not.toHaveBeenCalled();
    expect(report.degraded).toBe(false);
  });

  // The lock is created before the pre-flight runs, so in a repository that has
  // not gitignored it, counting it would fire a rescue on automata's own file.
  it("excludes automata's own run lock from the dirtiness check and the staging", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    const { runRepoHygiene } = await hygiene();
    runRepoHygiene(options(), NOW);
    expect(mockHasUncommittedChanges).toHaveBeenCalledWith([".automata/automata.lock"]);
    expect(mockStageAllExcept).toHaveBeenCalledWith([".automata/automata.lock"]);
  });

  it("creates a timestamped rescue branch when HEAD is the base branch", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue("develop");
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);

    expect(mockCreateBranchAtHead).toHaveBeenCalledWith("rescue/develop-20260910T054512Z");
    expect(mockCommitStaged).toHaveBeenCalledWith(
      "chore(automata): rescue uncommitted work from develop",
    );
    expect(mockPushSetUpstream).toHaveBeenCalledWith("rescue/develop-20260910T054512Z");
    expect(report.rescue).toEqual({
      kind: "rescued",
      branch: "rescue/develop-20260910T054512Z",
      createdBranch: true,
      pr: 99,
      prUrl: "https://gh/pr/99",
      prCreated: true,
    });
    expect(report.degraded).toBe(false);
  });

  it("opens the rescue pull request as a draft against the base branch, with no issue reference", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    const { runRepoHygiene, RESCUE_PR_LABEL } = await hygiene();
    runRepoHygiene(options(), NOW);
    const input = mockCreateDraftPullRequest.mock.calls[0][0] as {
      head: string;
      base: string;
      title: string;
      body: string;
      label: string;
    };
    expect(input.base).toBe("develop");
    expect(input.head).toBe("rescue/develop-20260910T054512Z");
    expect(input.label).toBe(RESCUE_PR_LABEL);
    expect(input.body).not.toMatch(/closes #/i);
  });

  it("commits onto the branch already checked out when it is not the base branch", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue("feature/031-update-all-npm");
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);

    // No parallel branch: the work belongs to the feature branch it was made on.
    expect(mockCreateBranchAtHead).not.toHaveBeenCalled();
    expect(mockPushSetUpstream).toHaveBeenCalledWith("feature/031-update-all-npm");
    expect(report.rescue).toMatchObject({
      kind: "rescued",
      branch: "feature/031-update-all-npm",
      createdBranch: false,
    });
  });

  it("does not open a second pull request when the branch already has an open one", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue("feature/x");
    mockListPullRequestsForHead.mockReturnValue([
      { number: 12, url: "https://gh/pr/12", state: "OPEN", updatedAt: "2026-09-10T00:00:00Z" },
    ]);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);

    expect(mockCreateDraftPullRequest).not.toHaveBeenCalled();
    expect(report.rescue).toMatchObject({ kind: "rescued", pr: 12, prCreated: false });
  });

  it("treats a detached HEAD like the base branch and never commits to the base branch", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue("HEAD");
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);

    expect(mockCreateBranchAtHead).toHaveBeenCalledWith("rescue/detached-20260910T054512Z");
    expect(mockPushSetUpstream).not.toHaveBeenCalledWith("develop");
    expect(report.rescue).toMatchObject({ kind: "rescued", createdBranch: true });
  });

  // Two separators, not one: a non-global replace would still pass with a single
  // slash, and `rescue/a/b-<stamp>` is a two-level ref rather than the flat name.
  it("flattens every slash in the base branch name into one rescue level", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue("release/2.0/rc");
    const { runRepoHygiene } = await hygiene();
    runRepoHygiene(options({ baseBranch: "release/2.0/rc" }), NOW);
    expect(mockCreateBranchAtHead).toHaveBeenCalledWith("rescue/release-2.0-rc-20260910T054512Z");
  });

  // Every rescue step is additive, so a failure leaves the tree exactly as dirty
  // as it was — the pre-existing per-item `dirty-tree` skip still applies.
  it.each([
    ["branch", () => mockCreateBranchAtHead.mockReturnValue(bad("already exists"))],
    ["stage", () => mockStageAllExcept.mockReturnValue(bad("permission denied"))],
    ["commit", () => mockCommitStaged.mockReturnValue(bad("nothing to commit"))],
    ["push", () => mockPushSetUpstream.mockReturnValue(bad("rejected"))],
  ])("reports a failure at the %s step and stops there", async (step, arrange) => {
    mockHasUncommittedChanges.mockReturnValue(true);
    arrange();
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);

    expect(report.rescue).toMatchObject({ kind: "failed", step });
    expect(report.degraded).toBe(true);
    expect(mockCreateDraftPullRequest).not.toHaveBeenCalled();
  });

  it("reports a pull-request failure after a successful push as failed, having kept the work safe", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    mockCreateDraftPullRequest.mockImplementation(() => {
      throw new Error("gh: HTTP 502");
    });
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);

    expect(mockPushSetUpstream).toHaveBeenCalled();
    expect(report.rescue).toEqual({ kind: "failed", step: "pr", detail: "gh: HTTP 502" });
    expect(report.degraded).toBe(true);
  });

  it("reports a failed open-PR lookup as a pr-step failure rather than opening a duplicate", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    mockListPullRequestsForHead.mockImplementation(() => {
      throw new Error("gh: HTTP 403");
    });
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);

    expect(report.rescue).toEqual({ kind: "failed", step: "pr", detail: "gh: HTTP 403" });
    expect(mockCreateDraftPullRequest).not.toHaveBeenCalled();
  });

  it("never stashes, resets or cleans — those calls do not exist in gitService's mock surface", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    const { runRepoHygiene } = await hygiene();
    runRepoHygiene(options(), NOW);
    // The mock defines every gitService function this module may use; anything
    // destructive would be an undefined import and throw here.
    expect(logged.join("")).toContain("rescue");
  });
});

// ── Step 2: base branch (US2) ────────────────────────────────────────────────

describe("base branch", () => {
  it("checks out and fast-forwards the base branch even with nothing else to do", async () => {
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockCheckoutBranch).toHaveBeenCalledWith("develop");
    expect(mockPullFastForwardOnly).toHaveBeenCalledWith();
    expect(report.base).toEqual({ ok: true });
  });

  it("runs after the rescue, so the rescued commits are not left behind on the wrong branch", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    const order: string[] = [];
    mockPushSetUpstream.mockImplementation(() => {
      order.push("push");
      return ok();
    });
    mockCheckoutBranch.mockImplementation(() => {
      order.push("checkout-base");
      return ok();
    });
    const { runRepoHygiene } = await hygiene();
    runRepoHygiene(options(), NOW);
    expect(order).toEqual(["push", "checkout-base"]);
  });

  it("reports a failed checkout and degrades the tick", async () => {
    mockCheckoutBranch.mockReturnValue(bad("error: pathspec 'develop' did not match"));
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(report.base).toEqual({
      ok: false,
      step: "checkout",
      detail: "error: pathspec 'develop' did not match",
    });
    expect(report.degraded).toBe(true);
    expect(mockPullFastForwardOnly).not.toHaveBeenCalled();
  });

  it("reports a non-fast-forward pull as a failure instead of merging", async () => {
    mockPullFastForwardOnly.mockReturnValue(bad("fatal: Not possible to fast-forward, aborting."));
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(report.base).toMatchObject({ ok: false, step: "pull" });
    expect(report.degraded).toBe(true);
  });
});

// ── Step 3: prune (US3) ──────────────────────────────────────────────────────

describe("prune", () => {
  function localAndRemote(local: string[], remote: string[] | null): void {
    mockListLocalBranches.mockReturnValue(local);
    mockListRemoteBranches.mockReturnValue(remote);
  }

  it("deletes a branch with no remote, no pull request and nothing outside the base branch", async () => {
    localAndRemote(["develop", "old/thing"], ["develop"]);
    mockListPullRequestsForHead.mockReturnValue([]);
    mockCountCommitsNotIn.mockReturnValue(0);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockForceDeleteLocalBranch).toHaveBeenCalledWith("old/thing");
    expect(report.prunes).toEqual([{ kind: "deleted", branch: "old/thing" }]);
    expect(report.degraded).toBe(false);
  });

  it.each(["MERGED", "CLOSED"])("deletes a branch whose only pull request is %s", async (state) => {
    localAndRemote(["develop", "old/thing"], ["develop"]);
    mockListPullRequestsForHead.mockReturnValue([
      { number: 5, url: "https://gh/pr/5", state, updatedAt: "2026-09-01T00:00:00Z" },
    ]);
    mockCountCommitsNotIn.mockReturnValue(0);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(report.prunes).toEqual([{ kind: "deleted", branch: "old/thing" }]);
  });

  // This repository squash-merges, so a merged branch's own commits are never in
  // develop — the reachability count is highest for exactly the branches that
  // are most safely deletable. GitHub saying MERGED has to win over the count.
  it("deletes a squash-merged branch without consulting the commit count", async () => {
    localAndRemote(["develop", "feature/update-spec-kit"], ["develop"]);
    mockListPullRequestsForHead.mockReturnValue([
      { number: 33, url: "https://gh/pr/33", state: "MERGED", updatedAt: "2026-09-08T00:00:00Z" },
    ]);
    mockCountCommitsNotIn.mockReturnValue(3);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockCountCommitsNotIn).not.toHaveBeenCalled();
    expect(report.prunes).toEqual([{ kind: "deleted", branch: "feature/update-spec-kit" }]);
    expect(mockCreateDraftPullRequest).not.toHaveBeenCalled();
  });

  it("prefers a merged pull request over one closed without merging", async () => {
    localAndRemote(["develop", "old/thing"], ["develop"]);
    mockListPullRequestsForHead.mockReturnValue([
      { number: 9, url: "https://gh/pr/9", state: "CLOSED", updatedAt: "2026-09-09T00:00:00Z" },
      { number: 4, url: "https://gh/pr/4", state: "MERGED", updatedAt: "2026-09-01T00:00:00Z" },
    ]);
    mockCountCommitsNotIn.mockReturnValue(7);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(report.prunes).toEqual([{ kind: "deleted", branch: "old/thing" }]);
  });

  // Closing a pull request without merging is a human decision that the branch
  // is not wanted, so it settles the branch just as a merge does. The commit
  // count must not be consulted: it would re-open work deliberately dropped.
  it("deletes a branch whose pull request was closed unmerged, whatever its commit count", async () => {
    localAndRemote(["develop", "abandoned/thing"], ["develop"]);
    mockListPullRequestsForHead.mockReturnValue([
      { number: 6, url: "https://gh/pr/6", state: "CLOSED", updatedAt: "2026-09-01T00:00:00Z" },
    ]);
    mockCountCommitsNotIn.mockReturnValue(2);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockCountCommitsNotIn).not.toHaveBeenCalled();
    expect(mockCreateDraftPullRequest).not.toHaveBeenCalled();
    expect(mockForceDeleteLocalBranch).toHaveBeenCalledWith("abandoned/thing");
    expect(report.prunes).toEqual([{ kind: "deleted", branch: "abandoned/thing" }]);
    expect(report.degraded).toBe(false);
  });

  it("reports which closed pull request settled the branch", async () => {
    localAndRemote(["develop", "abandoned/thing"], ["develop"]);
    mockListPullRequestsForHead.mockReturnValue([
      { number: 6, url: "https://gh/pr/6", state: "CLOSED", updatedAt: "2026-09-01T00:00:00Z" },
    ]);
    const lines: string[] = [];
    const { runRepoHygiene } = await hygiene();
    runRepoHygiene({ ...options(), log: (m) => lines.push(m) }, NOW);
    expect(lines.join("")).toContain("deleted abandoned/thing (PR #6 was closed unmerged)");
  });

  // An open pull request still wins: a branch can carry a stale closed attempt
  // and a live one, and the live one is the only outcome that keeps it.
  it("keeps a branch with both a closed and an open pull request", async () => {
    localAndRemote(["develop", "fix/second-try"], ["develop"]);
    mockListPullRequestsForHead.mockReturnValue([
      { number: 20, url: "https://gh/pr/20", state: "OPEN", updatedAt: "2026-09-10T00:00:00Z" },
      { number: 6, url: "https://gh/pr/6", state: "CLOSED", updatedAt: "2026-09-01T00:00:00Z" },
    ]);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockForceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(report.prunes).toMatchObject([{ kind: "kept", reason: "open-pr" }]);
  });

  it("keeps a branch with an open pull request, and does not count its commits", async () => {
    localAndRemote(["develop", "feature/live"], ["develop"]);
    mockListPullRequestsForHead.mockReturnValue([
      { number: 8, url: "https://gh/pr/8", state: "OPEN", updatedAt: "2026-09-10T00:00:00Z" },
    ]);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockForceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(mockCountCommitsNotIn).not.toHaveBeenCalled();
    expect(report.prunes).toEqual([
      { kind: "kept", branch: "feature/live", reason: "open-pr", detail: "PR #8 is open" },
    ]);
    // An open pull request is a normal outcome, not a degraded one.
    expect(report.degraded).toBe(false);
  });

  it("pushes and opens a draft pull request for a branch carrying unmerged commits, and keeps it", async () => {
    localAndRemote(["develop", "fix/wip"], ["develop"]);
    mockListPullRequestsForHead.mockReturnValue([]);
    mockCountCommitsNotIn.mockReturnValue(4);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);

    expect(mockForceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(mockPushSetUpstream).toHaveBeenCalledWith("fix/wip");
    expect(mockCreateDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ head: "fix/wip", base: "develop" }),
    );
    expect(report.prunes).toEqual([
      { kind: "rescued", branch: "fix/wip", pr: 99, prUrl: "https://gh/pr/99" },
    ]);
    // Pushed and given a pull request is the step working as designed.
    expect(report.degraded).toBe(false);
  });

  it("never considers the base branch, the current branch or a protected branch", async () => {
    localAndRemote(["develop", "master", "feature/current"], []);
    mockGetCurrentBranch.mockReturnValue("feature/current");
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(report.prunes).toEqual([]);
    expect(mockForceDeleteLocalBranch).not.toHaveBeenCalled();
  });

  it("never considers a branch that exists on origin, whatever its pull request state", async () => {
    localAndRemote(["develop", "feature/pushed"], ["develop", "feature/pushed"]);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(report.prunes).toEqual([]);
    expect(mockListPullRequestsForHead).not.toHaveBeenCalled();
  });

  it("keeps a branch whose pull-request lookup failed, and degrades the tick", async () => {
    localAndRemote(["develop", "old/thing"], ["develop"]);
    mockListPullRequestsForHead.mockImplementation(() => {
      throw new Error("gh: HTTP 502");
    });
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockForceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(report.prunes).toEqual([
      { kind: "kept", branch: "old/thing", reason: "lookup-failed", detail: "gh: HTTP 502" },
    ]);
    expect(report.degraded).toBe(true);
  });

  it("keeps a branch whose commit count could not be read", async () => {
    localAndRemote(["develop", "old/thing"], ["develop"]);
    mockCountCommitsNotIn.mockReturnValue(null);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockForceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(report.prunes).toMatchObject([{ kind: "kept", reason: "lookup-failed" }]);
    expect(report.degraded).toBe(true);
  });

  it("keeps a branch whose rescue push failed, and says so as push-failed", async () => {
    localAndRemote(["develop", "fix/wip"], ["develop"]);
    mockListPullRequestsForHead.mockReturnValue([]);
    mockCountCommitsNotIn.mockReturnValue(4);
    mockPushSetUpstream.mockReturnValue(bad("error: failed to push some refs"));
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockForceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(mockCreateDraftPullRequest).not.toHaveBeenCalled();
    expect(report.prunes).toEqual([
      {
        kind: "kept",
        branch: "fix/wip",
        reason: "push-failed",
        detail: "error: failed to push some refs",
      },
    ]);
    expect(report.degraded).toBe(true);
  });

  it("reports a failed deletion as a kept branch rather than aborting", async () => {
    localAndRemote(["develop", "old/thing"], ["develop"]);
    mockForceDeleteLocalBranch.mockReturnValue(bad("error: cannot delete branch"));
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(report.prunes).toEqual([
      {
        kind: "kept",
        branch: "old/thing",
        reason: "delete-failed",
        detail: "error: cannot delete branch",
      },
    ]);
    expect(report.degraded).toBe(true);
  });

  // Absence from a list we could not read is not evidence of anything.
  it("prunes nothing and degrades when origin's branches cannot be listed", async () => {
    localAndRemote(["develop", "old/thing"], null);
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(report.prunes).toEqual([]);
    expect(mockForceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(mockListPullRequestsForHead).not.toHaveBeenCalled();
    expect(report.degraded).toBe(true);
  });

  it("keeps a rescued branch even when its pull request could not be opened", async () => {
    localAndRemote(["develop", "fix/wip"], ["develop"]);
    mockCountCommitsNotIn.mockReturnValue(2);
    mockCreateDraftPullRequest.mockImplementation(() => {
      throw new Error("gh: HTTP 502");
    });
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockForceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(report.prunes).toEqual([{ kind: "rescued", branch: "fix/wip", pr: null, prUrl: null }]);
    // The work is safe on the remote, but a step failed and a human has to
    // finish it — reporting that as a healthy tick would hide it.
    expect(report.degraded).toBe(true);
  });

  it("keeps a branch with unmerged commits that could not be pushed", async () => {
    localAndRemote(["develop", "fix/wip"], ["develop"]);
    mockCountCommitsNotIn.mockReturnValue(2);
    mockPushSetUpstream.mockReturnValue(bad("rejected"));
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(mockForceDeleteLocalBranch).not.toHaveBeenCalled();
    expect(mockCreateDraftPullRequest).not.toHaveBeenCalled();
    expect(report.prunes).toMatchObject([{ kind: "kept", branch: "fix/wip" }]);
  });

  it("decides each of several candidates independently", async () => {
    localAndRemote(["develop", "gone/a", "live/b", "wip/c"], ["develop"]);
    mockListPullRequestsForHead.mockImplementation((branch: string) =>
      branch === "live/b"
        ? [{ number: 3, url: "https://gh/pr/3", state: "OPEN", updatedAt: "2026-09-10T00:00:00Z" }]
        : [],
    );
    mockCountCommitsNotIn.mockImplementation((_base: string, branch: string) =>
      branch === "wip/c" ? 3 : 0,
    );
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options(), NOW);
    expect(report.prunes.map((outcome) => [outcome.kind, outcome.branch])).toEqual([
      ["deleted", "gone/a"],
      ["kept", "live/b"],
      ["rescued", "wip/c"],
    ]);
  });
});

// ── Ordering and dry run (US4) ───────────────────────────────────────────────

describe("ordering", () => {
  it("runs rescue, then base, then prune", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    mockListLocalBranches.mockReturnValue(["develop", "old/thing"]);
    mockListRemoteBranches.mockReturnValue(["develop"]);
    const order: string[] = [];
    mockStageAllExcept.mockImplementation(() => {
      order.push("rescue");
      return ok();
    });
    mockCheckoutBranch.mockImplementation(() => {
      order.push("base");
      return ok();
    });
    mockForceDeleteLocalBranch.mockImplementation(() => {
      order.push("prune");
      return ok();
    });
    const { runRepoHygiene } = await hygiene();
    runRepoHygiene(options(), NOW);
    expect(order).toEqual(["rescue", "base", "prune"]);
  });
});

describe("dry run", () => {
  it("reports the whole plan and issues no mutating call", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue("develop");
    mockListLocalBranches.mockReturnValue(["develop", "old/thing", "fix/wip"]);
    mockListRemoteBranches.mockReturnValue(["develop"]);
    mockCountCommitsNotIn.mockImplementation((_base: string, branch: string) =>
      branch === "fix/wip" ? 4 : 0,
    );
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options({ dryRun: true }), NOW);

    expect(report.rescue).toEqual({
      kind: "would-rescue",
      branch: "rescue/develop-20260910T054512Z",
      createdBranch: true,
    });
    expect(report.base).toEqual({ ok: true });
    expect(report.prunes).toEqual([
      { kind: "would-delete", branch: "old/thing" },
      { kind: "would-rescue", branch: "fix/wip", unmergedCommits: 4 },
    ]);
    expectNothingMutated();
  });

  it("still reports a clean tree as clean under --dry-run", async () => {
    const { runRepoHygiene } = await hygiene();
    const report = runRepoHygiene(options({ dryRun: true }), NOW);
    expect(report.rescue).toEqual({ kind: "clean" });
    expectNothingMutated();
  });

  it("names both the rescue and the deletion in the log", async () => {
    mockHasUncommittedChanges.mockReturnValue(true);
    mockListLocalBranches.mockReturnValue(["develop", "old/thing"]);
    mockListRemoteBranches.mockReturnValue(["develop"]);
    const { runRepoHygiene } = await hygiene();
    runRepoHygiene(options({ dryRun: true }), NOW);
    const text = logged.join("");
    expect(text).toContain("would create rescue/develop-20260910T054512Z");
    expect(text).toContain("would delete old/thing");
    expect(text).toContain("dry run");
  });
});
