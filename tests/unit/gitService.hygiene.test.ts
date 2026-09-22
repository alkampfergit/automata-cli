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

describe("pathIsIgnored", () => {
  it("asks check-ignore, which consults the index, so a tracked path is not ignored", async () => {
    mockSpawnSync.mockReturnValue(ok());
    const { pathIsIgnored } = await service();
    expect(pathIsIgnored(".automata/automata.lock")).toBe(true);
    expect(lastArgs()).toEqual(["check-ignore", "-q", "--", ".automata/automata.lock"]);
  });

  it("answers false for anything but a clean exit 0, so a broken git keeps the exclusion", async () => {
    mockSpawnSync.mockReturnValue(bad("fatal: not a git repository", 128));
    const { pathIsIgnored } = await service();
    expect(pathIsIgnored(".automata/automata.lock")).toBe(false);
  });
});

describe("stageAllExcept", () => {
  /** check-ignore answers `ignored` for the listed paths; everything else succeeds. */
  function ignoring(ignored: string[]): void {
    mockSpawnSync.mockImplementation((_cmd: unknown, args: string[]) =>
      args[0] === "check-ignore" ? (ignored.includes(args[3]) ? ok() : bad("", 1)) : ok(),
    );
  }

  // -A is the only form that stages untracked files, which is the whole point:
  // anything hasUncommittedChanges counts and this misses leaves the tree dirty.
  it("stages everything with -A and excludes the given paths by pathspec", async () => {
    ignoring([]);
    const { stageAllExcept } = await service();
    stageAllExcept([".automata/automata.lock"]);
    expect(lastArgs()).toEqual(["add", "-A", "--", ".", ":(exclude).automata/automata.lock"]);
  });

  it("omits the pathspec entirely when nothing is excluded", async () => {
    ignoring([]);
    const { stageAllExcept } = await service();
    stageAllExcept([]);
    expect(lastArgs()).toEqual(["add", "-A"]);
  });

  // The reported defect: naming an ignored path in a pathspec makes `git add`
  // exit 1 — after staging everything correctly — so the rescue aborted work it
  // had in fact completed. Bare `-A` never stages an ignored path anyway.
  it("drops an exclusion the repository already ignores, falling back to bare -A", async () => {
    ignoring([".automata/automata.lock"]);
    const { stageAllExcept } = await service();
    const result = stageAllExcept([".automata/automata.lock"]);
    expect(lastArgs()).toEqual(["add", "-A"]);
    expect(result.ok).toBe(true);
  });

  it("keeps the exclusions that are not ignored when only some are", async () => {
    ignoring([".automata/automata.lock"]);
    const { stageAllExcept } = await service();
    stageAllExcept([".automata/automata.lock", "scratch/notes.md"]);
    expect(lastArgs()).toEqual(["add", "-A", "--", ".", ":(exclude)scratch/notes.md"]);
  });

  // check-ignore reports a tracked path as not ignored even when a pattern
  // matches it, and that is the safety property: a lock the repository tracks
  // must never be swept into the rescue commit.
  it("keeps the exclusion for a tracked path, so the run lock is never committed", async () => {
    ignoring([]);
    const { stageAllExcept } = await service();
    stageAllExcept([".automata/automata.lock"]);
    expect(lastArgs()).toEqual(["add", "-A", "--", ".", ":(exclude).automata/automata.lock"]);
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

describe("gitService command trace", () => {
  it("records a git that never started as -1, not as one that exited 1", async () => {
    // `spawnSync` sets `error` and leaves `status` null when the binary cannot
    // be started. The wrapper flattens that to 1 for its own callers, which is
    // right — but the trace is where an operator distinguishes "no git on PATH"
    // from "git ran and refused", and those want opposite fixes.
    const { startCommandTrace, takeCommandTrace } = await import("../../src/run/commandTrace.js");
    mockSpawnSync.mockReturnValue({
      stdout: "",
      stderr: "",
      status: null,
      error: Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }),
    });
    const { listLocalBranches } = await service();

    startCommandTrace();
    expect(listLocalBranches()).toEqual([]);
    const trace = takeCommandTrace();

    expect(trace?.length).toBe(1);
    expect(trace?.[0]?.exitCode).toBe(-1);
  });

  it("records a git that ran and failed with its own status", async () => {
    const { startCommandTrace, takeCommandTrace } = await import("../../src/run/commandTrace.js");
    mockSpawnSync.mockReturnValue(bad("fatal: not a git repository", 128));
    const { listLocalBranches } = await service();

    startCommandTrace();
    listLocalBranches();

    expect(takeCommandTrace()?.[0]?.exitCode).toBe(128);
  });
});
