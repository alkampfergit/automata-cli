import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock spawnSync to simulate git/gh CLI responses ───────────────────────────

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(stdout: string) {
  return { stdout, stderr: "", status: 0 };
}

function fail(stderr: string, status = 1) {
  return { stdout: "", stderr, status };
}

const MERGED_PR = {
  number: 42,
  title: "Add feature X",
  state: "MERGED",
  url: "https://github.com/org/repo/pull/42",
};
const OPEN_PR = { ...MERGED_PR, state: "OPEN" };
const CLOSED_PR = { ...MERGED_PR, state: "CLOSED" };

// ── Shared setup ──────────────────────────────────────────────────────────────

function captureStreams() {
  let stdout = "";
  let stderr = "";
  let exitCode: number | undefined;

  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  // Throw on exit so action handler execution stops at the exit call
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  }) as never);

  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    get exitCode() {
      return exitCode;
    },
  };
}

// ── get-pr-info ───────────────────────────────────────────────────────────────

describe("git get-pr-info command", () => {
  let out: ReturnType<typeof captureStreams>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    out = captureStreams();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("displays PR info in human-readable format", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n")) // getCurrentBranch
      .mockReturnValueOnce(ok(JSON.stringify(MERGED_PR))); // getPrInfo

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("#42");
    expect(out.stdout).toContain("Add feature X");
    expect(out.stdout).toContain("MERGED");
    expect(out.stdout).toContain("https://github.com/org/repo/pull/42");
    expect(out.exitCode).toBeUndefined();
  });

  it("outputs valid JSON with --json flag", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(MERGED_PR)));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info", "--json"]);

    expect(JSON.parse(out.stdout)).toEqual(MERGED_PR);
    expect(out.exitCode).toBeUndefined();
  });

  it("exits 0 with 'no PR found' message when gh finds no pull request", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(fail("no pull requests found"));

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "get-pr-info"])).rejects.toThrow("process.exit(0)");

    expect(out.stdout).toContain("No pull request found");
    expect(out.exitCode).toBe(0);
  });

  it("exits 1 with error when not inside a git repository", async () => {
    mockSpawnSync.mockReturnValueOnce(fail("fatal: not a git repository", 128));

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "get-pr-info"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("Failed to determine current branch");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when gh is not authenticated", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(fail("To authenticate, please run: gh auth login"));

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "get-pr-info"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("Error:");
    expect(out.exitCode).toBe(1);
  });
});

// ── finish-feature ────────────────────────────────────────────────────────────
//
// Sequence of spawnSync calls in the happy path:
//   1. git rev-parse --abbrev-ref HEAD       → getCurrentBranch
//   2. git status --porcelain                → hasUncommittedChanges
//   3. gh pr view <branch> --json ...        → getPrInfo
//   4. git ls-remote --exit-code --heads ... → isUpstreamGone
//   5. git fetch --prune                     → fetchPrune
//   6. git checkout develop                  → checkoutAndPull (checkout)
//   7. git pull                              → checkoutAndPull (pull)
//   8. git branch -d <branch>               → deleteLocalBranch

describe("git finish-feature command", () => {
  let out: ReturnType<typeof captureStreams>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    out = captureStreams();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("happy path: checks out develop, pulls, deletes merged branch", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n")) // getCurrentBranch
      .mockReturnValueOnce(ok("")) // hasUncommittedChanges → clean
      .mockReturnValueOnce(ok(JSON.stringify(MERGED_PR))) // getPrInfo → MERGED
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 2 }) // isUpstreamGone → gone
      .mockReturnValueOnce(ok("")) // fetchPrune
      .mockReturnValueOnce(ok("Switched to branch 'develop'\n")) // checkout
      .mockReturnValueOnce(ok("Already up to date.\n")) // pull
      .mockReturnValueOnce(ok("Deleted branch feature/my-branch.\n")); // deleteLocalBranch

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "finish-feature"]);

    expect(out.stdout).toContain("Fetching and pruning remote refs");
    expect(out.stdout).toContain("Checking out develop");
    expect(out.stdout).toContain("Deleting local branch: feature/my-branch");
    expect(out.stdout).toContain("Done");
    expect(out.exitCode).toBeUndefined();
  });

  it("exits 1 when run from the develop branch", async () => {
    mockSpawnSync.mockReturnValueOnce(ok("develop\n")); // getCurrentBranch → develop

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "finish-feature"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("cannot be run from the develop branch");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when there are uncommitted changes", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n")) // getCurrentBranch
      .mockReturnValueOnce(ok(" M src/index.ts\n")); // hasUncommittedChanges → dirty

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "finish-feature"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("uncommitted changes");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when no pull request exists for the branch", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok("")) // clean
      .mockReturnValueOnce(fail("no pull requests found")); // getPrInfo → null

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "finish-feature"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("No pull request found");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when the pull request is still open", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(""))
      .mockReturnValueOnce(ok(JSON.stringify(OPEN_PR))); // getPrInfo → OPEN

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "finish-feature"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("still open");
    expect(out.stderr).toContain("#42");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when the pull request was closed without merging", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(""))
      .mockReturnValueOnce(ok(JSON.stringify(CLOSED_PR))); // getPrInfo → CLOSED

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "finish-feature"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("closed without merging");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when the remote branch still exists", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(""))
      .mockReturnValueOnce(ok(JSON.stringify(MERGED_PR)))
      .mockReturnValueOnce(ok("abc123\trefs/heads/feature/my-branch\n")); // isUpstreamGone → false (still there)

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "finish-feature"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("origin/feature/my-branch");
    expect(out.stderr).toContain("still exists");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when checkout develop fails", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(""))
      .mockReturnValueOnce(ok(JSON.stringify(MERGED_PR)))
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 2 }) // upstream gone
      .mockReturnValueOnce(ok("")) // fetchPrune
      .mockReturnValueOnce(fail("error: pathspec 'develop' did not match any file(s)")); // checkout fails

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "finish-feature"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("Failed to checkout develop");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when git pull fails after checkout", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(""))
      .mockReturnValueOnce(ok(JSON.stringify(MERGED_PR)))
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 2 }) // upstream gone
      .mockReturnValueOnce(ok("")) // fetchPrune
      .mockReturnValueOnce(ok("Switched to branch 'develop'\n")) // checkout ok
      .mockReturnValueOnce(fail("error: could not read Username", 128)); // pull fails

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "finish-feature"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("Failed to pull develop");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when branch deletion fails", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(""))
      .mockReturnValueOnce(ok(JSON.stringify(MERGED_PR)))
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 2 }) // upstream gone
      .mockReturnValueOnce(ok("")) // fetchPrune
      .mockReturnValueOnce(ok("Switched to branch 'develop'\n")) // checkout
      .mockReturnValueOnce(ok("Already up to date.\n")) // pull
      .mockReturnValueOnce(fail("error: branch not fully merged")); // delete fails

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "finish-feature"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("Failed to delete branch feature/my-branch");
    expect(out.exitCode).toBe(1);
  });
});
