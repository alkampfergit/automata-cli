import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// These wrappers exist only to spawn a specific `git` invocation, so the argv is
// the whole contract — a wrong flag here is a wrong decision in the pre-flight,
// and only these tests can catch it.
const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: (...args: unknown[]) => mockSpawnSync(...args) };
});

function ok(stdout = ""): { stdout: string; stderr: string; status: number } {
  return { stdout, stderr: "", status: 0 };
}

function bad(stderr: string, status = 1): { stdout: string; stderr: string; status: number } {
  return { stdout: "", stderr, status };
}

function lastArgs(): string[] {
  const call = mockSpawnSync.mock.calls.at(-1);
  return call?.[1] as string[];
}

async function service(): Promise<typeof import("../../src/git/gitService.js")> {
  return import("../../src/git/gitService.js");
}

beforeEach(() => {
  mockSpawnSync.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("listLocalBranches", () => {
  it("asks for short refnames under refs/heads and drops blank lines", async () => {
    mockSpawnSync.mockReturnValue(ok("develop\nfeature/a\n\nfix/b\n"));
    const { listLocalBranches } = await service();
    expect(listLocalBranches()).toEqual(["develop", "feature/a", "fix/b"]);
    expect(lastArgs()).toEqual(["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  });

  it("returns an empty list when git fails", async () => {
    mockSpawnSync.mockReturnValue(bad("fatal: not a git repository", 128));
    const { listLocalBranches } = await service();
    expect(listLocalBranches()).toEqual([]);
  });
});

describe("listRemoteBranches", () => {
  it("parses ls-remote output, keeping slashes in branch names", async () => {
    mockSpawnSync.mockReturnValue(
      ok(
        "3dd7721a9e20e925090d30d5f9e6fbfc547082cf\trefs/heads/develop\n" +
          "5cda2907faaa1ac220ff82b9f106b8d839c00f63\trefs/heads/dependabot/npm_and_yarn/vite-8.0.16\n",
      ),
    );
    const { listRemoteBranches } = await service();
    expect(listRemoteBranches()).toEqual(["develop", "dependabot/npm_and_yarn/vite-8.0.16"]);
    expect(lastArgs()).toEqual(["ls-remote", "--heads", "origin"]);
  });

  it("ignores refs that are not branch heads", async () => {
    mockSpawnSync.mockReturnValue(ok("abc123\trefs/tags/v1.2.3\nabc123\trefs/heads/develop\n"));
    const { listRemoteBranches } = await service();
    expect(listRemoteBranches()).toEqual(["develop"]);
  });

  // The distinction the prune step's safety rests on: absence from a list we
  // could not read is not evidence that a branch has no remote.
  it("returns null — not an empty list — when the remote cannot be reached", async () => {
    mockSpawnSync.mockReturnValue(bad("fatal: could not read from remote repository", 128));
    const { listRemoteBranches } = await service();
    expect(listRemoteBranches()).toBeNull();
  });

  it("returns an empty list for a remote with no branches", async () => {
    mockSpawnSync.mockReturnValue(ok(""));
    const { listRemoteBranches } = await service();
    expect(listRemoteBranches()).toEqual([]);
  });
});

describe("createBranchAtHead", () => {
  it("runs checkout -b without a start point, so it branches off HEAD", async () => {
    mockSpawnSync.mockReturnValue(ok());
    const { createBranchAtHead } = await service();
    expect(createBranchAtHead("rescue/develop-20260910T054512Z")).toEqual({ ok: true, stderr: "" });
    expect(lastArgs()).toEqual(["checkout", "-b", "rescue/develop-20260910T054512Z"]);
  });

  it("reports a failure rather than throwing", async () => {
    mockSpawnSync.mockReturnValue(bad("fatal: a branch named 'x' already exists\n"));
    const { createBranchAtHead } = await service();
    expect(createBranchAtHead("x")).toEqual({
      ok: false,
      stderr: "fatal: a branch named 'x' already exists",
    });
  });
});

describe("stageAllExcept", () => {
  // -A is the only form that stages untracked files, which is the whole point:
  // anything hasUncommittedChanges counts and this misses leaves the tree dirty.
  it("stages everything with -A and excludes the given paths by pathspec", async () => {
    mockSpawnSync.mockReturnValue(ok());
    const { stageAllExcept } = await service();
    stageAllExcept([".automata/automata.lock"]);
    expect(lastArgs()).toEqual(["add", "-A", "--", ".", ":(exclude).automata/automata.lock"]);
  });

  it("omits the pathspec entirely when nothing is excluded", async () => {
    mockSpawnSync.mockReturnValue(ok());
    const { stageAllExcept } = await service();
    stageAllExcept([]);
    expect(lastArgs()).toEqual(["add", "-A"]);
  });
});

describe("commitStaged", () => {
  it("commits only what is staged", async () => {
    mockSpawnSync.mockReturnValue(ok());
    const { commitStaged } = await service();
    commitStaged("chore(automata): rescue uncommitted work from develop");
    // No -a and no -A: staging was a separate, explicitly-scoped step.
    expect(lastArgs()).toEqual([
      "commit",
      "-m",
      "chore(automata): rescue uncommitted work from develop",
    ]);
  });
});

describe("pushSetUpstream", () => {
  it("names the branch, so it works without checking it out", async () => {
    mockSpawnSync.mockReturnValue(ok());
    const { pushSetUpstream } = await service();
    pushSetUpstream("fix/wip");
    expect(lastArgs()).toEqual(["push", "-u", "origin", "fix/wip"]);
  });
});

describe("countCommitsNotIn", () => {
  it("counts the branch's commits that the base branch does not have", async () => {
    mockSpawnSync.mockReturnValue(ok("4\n"));
    const { countCommitsNotIn } = await service();
    expect(countCommitsNotIn("develop", "fix/wip")).toBe(4);
    expect(lastArgs()).toEqual(["rev-list", "--count", "develop..fix/wip"]);
  });

  it("returns 0 for a branch fully contained in the base branch", async () => {
    mockSpawnSync.mockReturnValue(ok("0\n"));
    const { countCommitsNotIn } = await service();
    expect(countCommitsNotIn("develop", "old/thing")).toBe(0);
  });

  // A branch is deleted only on a confirmed zero, so both of these must be null
  // rather than anything a caller could mistake for "nothing would be lost".
  it("returns null when the ref cannot be resolved", async () => {
    mockSpawnSync.mockReturnValue(bad("fatal: bad revision 'develop..ghost'", 128));
    const { countCommitsNotIn } = await service();
    expect(countCommitsNotIn("develop", "ghost")).toBeNull();
  });

  it("returns null on output that is not a bare count", async () => {
    mockSpawnSync.mockReturnValue(ok("not a number\n"));
    const { countCommitsNotIn } = await service();
    expect(countCommitsNotIn("develop", "fix/wip")).toBeNull();
  });
});

describe("forceDeleteLocalBranch", () => {
  it("force-deletes and reports failure instead of throwing", async () => {
    mockSpawnSync.mockReturnValue(bad("error: cannot delete branch 'develop' checked out\n"));
    const { forceDeleteLocalBranch } = await service();
    expect(forceDeleteLocalBranch("develop")).toEqual({
      ok: false,
      stderr: "error: cannot delete branch 'develop' checked out",
    });
    expect(lastArgs()).toEqual(["branch", "-D", "develop"]);
  });

  it("reports success", async () => {
    mockSpawnSync.mockReturnValue(ok("Deleted branch old/thing (was abc1234).\n"));
    const { forceDeleteLocalBranch } = await service();
    expect(forceDeleteLocalBranch("old/thing")).toEqual({ ok: true, stderr: "" });
  });
});
