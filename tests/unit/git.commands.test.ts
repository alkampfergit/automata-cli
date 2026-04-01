import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock spawnSync to simulate git/gh CLI responses ───────────────────────────

const mockSpawnSync = vi.fn();

// ── Mock configStore so azdo dispatch tests can set remoteType ────────────────

const mockReadConfig = vi.fn(() => ({}));

vi.mock("../../src/config/configStore.js", () => ({
  readConfig: () => mockReadConfig(),
  writeConfig: vi.fn(),
}));

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

function fetchOk(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  };
}

function fetchError(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({}),
  };
}

// Extra mocks needed when getPrInfo finds failed checks:
// 1. git remote get-url origin (parseOwnerRepo)
// 2. gh api …/check-runs (fetchCheckRunOutputs) — empty = no enrichment
function noEnrichment() {
  return [ok("https://github.com/org/repo.git\n"), ok("")] as const;
}

const MERGED_PR = {
  number: 42,
  title: "Add feature X",
  state: "MERGED",
  url: "https://github.com/org/repo/pull/42",
  headRefOid: "abc123def456",
  statusCheckRollup: null,
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

  it("outputs valid JSON with --json flag including checks array", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(MERGED_PR)));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info", "--json"]);

    const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
    expect(parsed.number).toBe(42);
    expect(parsed.state).toBe("MERGED");
    expect(Array.isArray(parsed.checks)).toBe(true);
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

// ── get-pr-info: check summary lines ─────────────────────────────────────────

describe("git get-pr-info check summary lines", () => {
  let out: ReturnType<typeof captureStreams>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    out = captureStreams();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("shows 'Checks Running: false' and 'Check Errors: none' when all checks pass", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "" },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("Checks Running: false");
    expect(out.stdout).toContain("Check Errors:   none");
  });

  it("shows 'Checks Running: true' when any check is pending", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "deploy", status: "IN_PROGRESS", conclusion: null, description: "", detailsUrl: "" },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("Checks Running: true");
  });

  it("shows 'Check Errors' with name and description for each failed check", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "test", status: "COMPLETED", conclusion: "FAILURE", description: "3 tests failed", detailsUrl: "" },
        { name: "lint", status: "COMPLETED", conclusion: "FAILURE", description: "", detailsUrl: "" },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("Check Errors:   test: 3 tests failed; lint: no details available");
  });

  it("shows 'Checks Running: false' and 'Check Errors: none' when no checks", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify({ ...MERGED_PR, statusCheckRollup: [] })));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("Checks Running: false");
    expect(out.stdout).toContain("Check Errors:   none");
  });
});

// ── get-pr-info: checks rendering ────────────────────────────────────────────

describe("git get-pr-info checks rendering", () => {
  let out: ReturnType<typeof captureStreams>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    out = captureStreams();
    fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("shows 'Checks: none' when statusCheckRollup is empty", async () => {
    const pr = { ...MERGED_PR, statusCheckRollup: [] };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("Checks: none");
  });

  it("shows ✓ for a passing check", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "" },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("✓ build");
    expect(out.stdout).not.toContain("Details:");
  });

  it("shows ✗ for a failed check and defers details to FailedChecks", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "test", status: "COMPLETED", conclusion: "FAILURE", description: "3 tests failed", detailsUrl: "" },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("✗ test");
    expect(out.stdout).toContain("FailedChecks:");
    expect(out.stdout).toContain("Details: 3 tests failed");
  });

  it("shows '(no details available)' in FailedChecks when failed check has no description and no detailsUrl", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "lint", status: "COMPLETED", conclusion: "FAILURE", description: "", detailsUrl: "" },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("✗ lint");
    expect(out.stdout).toContain("FailedChecks:");
    expect(out.stdout).toContain("(no details available)");
  });

  it("shows URL line in FailedChecks when failed check has no description but has a detailsUrl", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "SonarCloud Code Analysis", status: "COMPLETED", conclusion: "FAILURE", description: "", detailsUrl: "https://sonarcloud.io" },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("✗ SonarCloud Code Analysis");
    expect(out.stdout).toContain("FailedChecks:");
    expect(out.stdout).toContain("URL:     https://sonarcloud.io");
  });

  it("shows ● for an in-progress check", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "deploy", status: "IN_PROGRESS", conclusion: null, description: "", detailsUrl: "" },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("● deploy (pending)");
    expect(out.stdout).not.toContain("FailedChecks:");
  });

  it("JSON output contains checks array with correct fields", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "https://example.com" },
        { name: "test", status: "COMPLETED", conclusion: "FAILURE", description: "fail msg", detailsUrl: "https://example.com/2" },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info", "--json"]);

    const parsed = JSON.parse(out.stdout) as { checks: Array<{ name: string; conclusion: string; description: string }> };
    expect(parsed.checks).toHaveLength(2);
    expect(parsed.checks[0].name).toBe("build");
    expect(parsed.checks[0].conclusion).toBe("SUCCESS");
    expect(parsed.checks[1].name).toBe("test");
    expect(parsed.checks[1].description).toBe("fail msg");
  });

  it("enriches failed check title and URL from gh api check-runs output", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "SonarCloud Code Analysis", status: "COMPLETED", conclusion: "FAILURE", description: "", detailsUrl: "https://sonarcloud.io" },
      ],
    };
    const enrichedLine = JSON.stringify({
      name: "SonarCloud Code Analysis",
      html_url: "https://github.com/org/repo/runs/99",
      details_url: "https://sonarcloud.io",
      output: {
        title: "Quality Gate failed",
        summary: "Some text [See analysis details](https://sonarcloud.io/dashboard?id=org_repo&pullRequest=5)\n",
      },
    });
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(ok("https://github.com/org/repo.git\n"))
      .mockReturnValueOnce(ok(enrichedLine));

    fetchMock
      .mockResolvedValueOnce(fetchOk({ paging: { total: 7 } }))
      .mockResolvedValueOnce(fetchOk({
        projectStatus: {
          status: "ERROR",
          conditions: [],
        },
      }))
      .mockResolvedValueOnce(fetchOk({
        paging: { pageIndex: 1, pageSize: 100, total: 0 },
        issues: [],
        components: [],
        rules: [],
      }));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("✗ SonarCloud Code Analysis");
    expect(out.stdout).toContain("FailedChecks:");
    expect(out.stdout).toContain("Details: Quality Gate failed");
    expect(out.stdout).toContain("URL:     https://sonarcloud.io/dashboard?id=org_repo&pullRequest=5");
  });
});

// ── get-pr-info: --wait-finish-checks ─────────────────────────────────────────

describe("git get-pr-info --wait-finish-checks", () => {
  let out: ReturnType<typeof captureStreams>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockReadConfig.mockReset();
    out = captureStreams();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.useRealTimers();
  });

  it("renders normal get-pr-info output when all checks succeed immediately", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "" },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info", "--wait-finish-checks"]);

    expect(out.stdout).toContain("PR:    #42");
    expect(out.stdout).toContain("Checks Running: false");
    expect(out.stdout).toContain("✓ build");
    expect(out.exitCode).toBeUndefined();
  });

  it("renders normal get-pr-info output with FailedChecks when checks fail", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "" },
        { name: "sonar", status: "COMPLETED", conclusion: "FAILURE", description: "Quality Gate failed", detailsUrl: "https://sonarcloud.io/dashboard" },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info", "--wait-finish-checks"]);

    expect(out.stdout).toContain("✓ build");
    expect(out.stdout).toContain("✗ sonar");
    expect(out.stdout).toContain("FailedChecks:");
    expect(out.stdout).toContain("Quality Gate failed");
    expect(out.stdout).toContain("URL:     https://sonarcloud.io/dashboard");
    expect(out.exitCode).toBeUndefined();
  });

  it("polls until running checks complete then renders the normal output", async () => {
    const runningPr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "build", status: "IN_PROGRESS", conclusion: null, description: "", detailsUrl: "" },
      ],
    };
    const donePr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "" },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n")) // getCurrentBranch
      .mockReturnValueOnce(ok(JSON.stringify(runningPr))) // first poll → still running
      .mockReturnValueOnce(ok(JSON.stringify(donePr)));  // second poll → done

    const { gitCommand } = await import("../../src/commands/git.js");
    const parsePromise = gitCommand.parseAsync(["node", "git", "get-pr-info", "--wait-finish-checks"]);
    // Attach handler before advancing timers to avoid unhandled rejection warning
    parsePromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(10_000);
    await parsePromise;

    expect(out.stdout).toContain("Waiting for 1 check(s) to complete...");
    expect(out.stdout).toContain("PR:    #42");
    expect(out.stdout).toContain("✓ build");
    expect(out.exitCode).toBeUndefined();
  });

  it("outputs the normal PR json with --json flag after waiting", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "" },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info", "--wait-finish-checks", "--json"]);

    const parsed = JSON.parse(out.stdout) as { number: number; checks: Array<{ name: string }> };
    expect(parsed.number).toBe(42);
    expect(parsed.checks[0]?.name).toBe("build");
    expect(out.exitCode).toBeUndefined();
  });

  it("keeps the normal PR json shape with --json when checks fail", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "" },
        { name: "sonar", status: "COMPLETED", conclusion: "FAILURE", description: "Quality Gate failed", detailsUrl: "https://sonarcloud.io/dashboard" },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info", "--wait-finish-checks", "--json"]);

    const parsed = JSON.parse(out.stdout) as { number: number; checks: Array<{ name: string; conclusion: string }> };
    expect(parsed.number).toBe(42);
    expect(parsed.checks).toHaveLength(2);
    expect(parsed.checks[1]).toMatchObject({ name: "sonar", conclusion: "FAILURE" });
    expect(out.exitCode).toBeUndefined();
  });

  it("matches normal no-PR behavior when no PR exists", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(fail("no pull requests found"));

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "get-pr-info", "--wait-finish-checks"])).rejects.toThrow("process.exit(0)");

    expect(out.stdout).toContain("No pull request found");
    expect(out.exitCode).toBe(0);
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

// ── get-pr-comments ───────────────────────────────────────────────────────────
//
// Sequence of spawnSync calls:
//   1. git rev-parse --abbrev-ref HEAD   → getCurrentBranch
//   2. gh pr view <branch> --json number → getPrComments (PR number lookup)
//   3. git remote get-url origin         → parseOwnerRepo
//   4. gh api graphql ...                → getPrComments (review threads)

function gqlResponse(threads: Array<{ isResolved: boolean; author: string; body: string; path: string; line: number | null }>) {
  return ok(
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: threads.map((t) => ({
                isResolved: t.isResolved,
                isOutdated: false,
                comments: {
                  nodes: [{ author: { login: t.author }, body: t.body, path: t.path, line: t.line, createdAt: "2026-03-30T10:00:00Z" }],
                },
              })),
            },
          },
        },
      },
    }),
  );
}

describe("git get-pr-comments command", () => {
  let out: ReturnType<typeof captureStreams>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockReadConfig.mockReset();
    out = captureStreams();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("displays unresolved threads in human-readable format", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))           // getCurrentBranch
      .mockReturnValueOnce(ok(JSON.stringify({ number: 42 })))  // gh pr view --json number
      .mockReturnValueOnce(ok("https://github.com/org/repo.git\n")) // parseOwnerRepo
      .mockReturnValueOnce(gqlResponse([
        { isResolved: false, author: "alice", body: "Fix this please", path: "src/foo.ts", line: 10 },
        { isResolved: true,  author: "bob",   body: "Already done",    path: "src/bar.ts", line: 5 },
      ]));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-comments"]);

    expect(out.stdout).toContain("[alice] on src/foo.ts:10");
    expect(out.stdout).toContain("Fix this please");
    expect(out.stdout).not.toContain("bob");
    expect(out.stdout).not.toContain("Already done");
    expect(out.exitCode).toBeUndefined();
  });

  it("shows '(file)' when line is null", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify({ number: 42 })))
      .mockReturnValueOnce(ok("https://github.com/org/repo.git\n"))
      .mockReturnValueOnce(gqlResponse([
        { isResolved: false, author: "carol", body: "Add a license header", path: "src/index.ts", line: null },
      ]));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-comments"]);

    expect(out.stdout).toContain("[carol] on src/index.ts:(file)");
    expect(out.stdout).toContain("Add a license header");
    expect(out.exitCode).toBeUndefined();
  });

  it("prints 'No open comments.' when all threads are resolved", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify({ number: 42 })))
      .mockReturnValueOnce(ok("https://github.com/org/repo.git\n"))
      .mockReturnValueOnce(gqlResponse([
        { isResolved: true, author: "alice", body: "Done", path: "src/foo.ts", line: 1 },
      ]));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-comments"]);

    expect(out.stdout).toBe("No open comments.\n");
    expect(out.exitCode).toBeUndefined();
  });

  it("outputs valid JSON array with --json flag", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify({ number: 42 })))
      .mockReturnValueOnce(ok("https://github.com/org/repo.git\n"))
      .mockReturnValueOnce(gqlResponse([
        { isResolved: false, author: "alice", body: "Fix this", path: "src/foo.ts", line: 10 },
      ]));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-comments", "--json"]);

    const parsed = JSON.parse(out.stdout) as Array<{ author: string; body: string; path: string; line: number }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].author).toBe("alice");
    expect(parsed[0].body).toBe("Fix this");
    expect(parsed[0].path).toBe("src/foo.ts");
    expect(parsed[0].line).toBe(10);
    expect(out.exitCode).toBeUndefined();
  });

  it("outputs [] with --json when no unresolved threads", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify({ number: 42 })))
      .mockReturnValueOnce(ok("https://github.com/org/repo.git\n"))
      .mockReturnValueOnce(gqlResponse([]));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-comments", "--json"]);

    expect(out.stdout.trim()).toBe("[]");
    expect(out.exitCode).toBeUndefined();
  });

  it("exits 1 with error when no PR found for branch", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(fail("no pull requests found"));

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "get-pr-comments"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("No pull request found for branch: feature/my-branch");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 with error when not inside a git repository", async () => {
    mockSpawnSync.mockReturnValueOnce(fail("fatal: not a git repository", 128));

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "get-pr-comments"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("Failed to determine current branch");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 with unsupported message when remoteType is azdo", async () => {
    mockReadConfig.mockReturnValue({ remoteType: "azdo" });
    mockSpawnSync.mockReturnValueOnce(ok("feature/my-branch\n"));

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(gitCommand.parseAsync(["node", "git", "get-pr-comments"])).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("not supported for Azure DevOps");
    expect(out.stderr).toContain("docs/azdo-gap.md");
    expect(out.exitCode).toBe(1);
  });

  it("strips ANSI escape sequences from comment bodies before output", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify({ number: 42 })))
      .mockReturnValueOnce(ok("https://github.com/org/repo.git\n"))
      .mockReturnValueOnce(gqlResponse([
        { isResolved: false, author: "attacker", body: "\x1b[31mRed text\x1b[0m normal", path: "src/foo.ts", line: 1 },
      ]));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-comments"]);

    expect(out.stdout).toContain("Red text normal");
    expect(out.stdout).not.toContain("\x1b[");
    expect(out.exitCode).toBeUndefined();
  });
});

// ── azdo dispatch ─────────────────────────────────────────────────────────────

describe("git get-pr-info: azdo dispatch", () => {
  let out: ReturnType<typeof captureStreams>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockReadConfig.mockReset();
    out = captureStreams();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("calls azdo pr status when remoteType is azdo", async () => {
    mockReadConfig.mockReturnValue({ remoteType: "azdo" });
    const azdoPrOutput = {
      pullRequests: [
        { id: 7, title: "AzDO PR", status: "active", url: "https://dev.azure.com/o/p/_git/r/pullrequest/7" },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n")) // getCurrentBranch
      .mockReturnValueOnce(ok(JSON.stringify(azdoPrOutput))); // azdo pr status --json

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("#7");
    expect(out.stdout).toContain("AzDO PR");
    expect(out.stdout).toContain("OPEN");
    const calls = mockSpawnSync.mock.calls as [string, string[]][];
    const azdoCall = calls.find(([cmd]) => cmd === "azdo");
    expect(azdoCall).toBeDefined();
    expect(azdoCall?.[1]).toEqual(["pr", "status", "--json"]);
    expect(out.exitCode).toBeUndefined();
  });

  it("maps azdo completed status to MERGED for finish-feature", async () => {
    mockReadConfig.mockReturnValue({ remoteType: "azdo" });
    const azdoMergedOutput = {
      pullRequests: [
        { id: 9, title: "Done", status: "completed", url: "https://dev.azure.com/o/p/_git/r/pullrequest/9" },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n")) // getCurrentBranch
      .mockReturnValueOnce(ok("")) // hasUncommittedChanges → clean
      .mockReturnValueOnce(ok(JSON.stringify(azdoMergedOutput))) // azdo pr status → MERGED
      .mockReturnValueOnce({ stdout: "", stderr: "", status: 2 }) // isUpstreamGone → gone
      .mockReturnValueOnce(ok("")) // fetchPrune
      .mockReturnValueOnce(ok("Switched to branch 'develop'\n")) // checkout
      .mockReturnValueOnce(ok("Already up to date.\n")) // pull
      .mockReturnValueOnce(ok("")); // deleteLocalBranch

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "finish-feature"]);

    expect(out.stdout).toContain("Done");
    expect(out.exitCode).toBeUndefined();
  });
});

// ── publish-release CLI preconditions ─────────────────────────────────────────

describe("git publish-release command: preconditions", () => {
  let out: ReturnType<typeof captureStreams>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    out = captureStreams();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("exits 1 with error when not on develop branch", async () => {
    mockSpawnSync.mockReturnValueOnce(ok("feature/some-branch\n")); // getCurrentBranch

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(
      gitCommand.parseAsync(["node", "git", "publish-release", "1.3.0"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("develop");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 with error when working tree is dirty", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("develop\n")) // getCurrentBranch
      .mockReturnValueOnce(ok("M src/foo.ts\n")); // hasUncommittedChanges → dirty

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(
      gitCommand.parseAsync(["node", "git", "publish-release", "1.3.0"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("uncommitted changes");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 with error when version is not valid semver", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("develop\n")) // getCurrentBranch
      .mockReturnValueOnce(ok("")); // hasUncommittedChanges → clean

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(
      gitCommand.parseAsync(["node", "git", "publish-release", "not-a-version"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("not valid semver");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 with error when tag already exists", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("develop\n")) // getCurrentBranch
      .mockReturnValueOnce(ok("")) // hasUncommittedChanges → clean
      .mockReturnValueOnce(ok("1.3.0\n")); // tagExists → true

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(
      gitCommand.parseAsync(["node", "git", "publish-release", "1.3.0"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("already exists");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when no semver tag found on master and no version supplied", async () => {
    mockSpawnSync
      .mockReturnValueOnce(ok("develop\n")) // getCurrentBranch
      .mockReturnValueOnce(ok("")) // hasUncommittedChanges → clean
      .mockReturnValueOnce(fail("fatal: No names found", 128)); // getLatestTagOnMaster → null

    const { gitCommand } = await import("../../src/commands/git.js");
    await expect(
      gitCommand.parseAsync(["node", "git", "publish-release"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("No semver tag found");
    expect(out.exitCode).toBe(1);
  });
});

// ── get-pr-info: SonarCloud detection ────────────────────────────────────────

describe("git get-pr-info SonarCloud fields", () => {
  let out: ReturnType<typeof captureStreams>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockReadConfig.mockReset();
    out = captureStreams();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("shows sonarcloudUrl and new-issue count when a SonarCloud check is present", async () => {
    const sonarUrl = "https://sonarcloud.io/summary/new_code?id=my_project&pullRequest=42";
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "SonarCloud Code Analysis", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: sonarUrl },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    fetchMock.mockResolvedValueOnce(fetchOk({ paging: { total: 3 } }));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("Sonar:");
    expect(out.stdout).toContain(sonarUrl);
    expect(out.stdout).toContain("Sonar New Issues: 3");
  });

  it("shows 'unavailable' for new-issue count when SonarCloud API fails", async () => {
    const sonarUrl = "https://sonarcloud.io/summary/new_code?id=my_project&pullRequest=42";
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "SonarCloud Code Analysis", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: sonarUrl },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("Sonar:");
    expect(out.stdout).toContain("Sonar New Issues: unavailable");
  });

  it("does not show SonarCloud fields when no SonarCloud check is present", async () => {
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: "https://ci.example.com" },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).not.toContain("Sonar:");
    expect(out.stdout).not.toContain("Sonar New Issues:");
  });

  it("JSON output includes sonarcloudUrl and sonarNewIssues when SonarCloud check is present", async () => {
    const sonarUrl = "https://sonarcloud.io/summary/new_code?id=my_project&pullRequest=42";
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        { name: "SonarCloud Code Analysis", status: "COMPLETED", conclusion: "SUCCESS", description: "", detailsUrl: sonarUrl },
      ],
    };
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)));

    fetchMock.mockResolvedValueOnce(fetchOk({ paging: { total: 5 } }));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info", "--json"]);

    const parsed = JSON.parse(out.stdout) as { sonarcloudUrl?: string; sonarNewIssues?: number };
    expect(parsed.sonarcloudUrl).toBe(sonarUrl);
    expect(parsed.sonarNewIssues).toBe(5);
  });

  it("shows gate violations and issue details for a failing public SonarCloud check", async () => {
    const sonarUrl = "https://sonarcloud.io/summary/new_code?id=my_project&pullRequest=42";
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        {
          name: "SonarCloud Code Analysis",
          status: "COMPLETED",
          conclusion: "FAILURE",
          description: "Quality Gate failed",
          detailsUrl: sonarUrl,
        },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    fetchMock
      .mockResolvedValueOnce(fetchOk({ paging: { total: 1 } }))
      .mockResolvedValueOnce(fetchOk({
        projectStatus: {
          status: "ERROR",
          conditions: [
            {
              status: "ERROR",
              metricKey: "new_duplicated_lines_density",
              comparator: "GT",
              actualValue: "4.1",
              errorThreshold: "3",
            },
          ],
        },
      }))
      .mockResolvedValueOnce(fetchOk({
        paging: { pageIndex: 1, pageSize: 100, total: 1 },
        issues: [
          {
            key: "issue-1",
            rule: "typescript:S1871",
            severity: "MAJOR",
            type: "CODE_SMELL",
            message: "Refactor this conditional structure to avoid duplicated code.",
            component: "my_project:src/commands/git.ts",
            line: 42,
          },
        ],
        components: [
          {
            key: "my_project:src/commands/git.ts",
            path: "src/commands/git.ts",
          },
        ],
        rules: [
          {
            key: "typescript:S1871",
            name: "Conditional structure should not have exactly the same implementation",
            htmlDesc: "<p>Duplicated branches make code harder to maintain.</p>",
          },
        ],
      }));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("Sonar Failures:");
    expect(out.stdout).toContain("Gate Violations:");
    expect(out.stdout).toContain("new_duplicated_lines_density | actual 4.1 | GT 3");
    expect(out.stdout).toContain("Issues:");
    expect(out.stdout).toContain("Location: src/commands/git.ts:42");
    expect(out.stdout).toContain("Explanation: Duplicated branches make code harder to maintain.");
  });

  it("shows a private-project note when SonarCloud returns 401", async () => {
    const sonarUrl = "https://sonarcloud.io/summary/new_code?id=my_project&pullRequest=42";
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        {
          name: "SonarCloud Code Analysis",
          status: "COMPLETED",
          conclusion: "FAILURE",
          description: "Quality Gate failed",
          detailsUrl: sonarUrl,
        },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    fetchMock
      .mockResolvedValueOnce(fetchError(401))
      .mockResolvedValueOnce(fetchError(401))
      .mockResolvedValueOnce(fetchError(401));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info"]);

    expect(out.stdout).toContain("Sonar Failures:");
    expect(out.stdout).toContain("SonarCloud project is private.");
    expect(out.stdout).toContain("authenticated browser");
  });

  it("JSON output includes structured sonarFailures data for failing public SonarCloud checks", async () => {
    const sonarUrl = "https://sonarcloud.io/summary/new_code?id=my_project&pullRequest=42";
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        {
          name: "SonarCloud Code Analysis",
          status: "COMPLETED",
          conclusion: "FAILURE",
          description: "Quality Gate failed",
          detailsUrl: sonarUrl,
        },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    fetchMock
      .mockResolvedValueOnce(fetchOk({ paging: { total: 2 } }))
      .mockResolvedValueOnce(fetchOk({
        projectStatus: {
          status: "ERROR",
          conditions: [
            {
              status: "ERROR",
              metricKey: "new_security_hotspots_reviewed",
              comparator: "LT",
              actualValue: "0",
              errorThreshold: "100",
            },
          ],
        },
      }))
      .mockResolvedValueOnce(fetchOk({
        paging: { pageIndex: 1, pageSize: 100, total: 1 },
        issues: [
          {
            key: "issue-2",
            rule: "typescript:S1128",
            severity: "MINOR",
            type: "CODE_SMELL",
            message: "Remove this unused import.",
            component: "my_project:src/git/gitService.ts",
            textRange: { startLine: 8 },
          },
        ],
        components: [
          {
            key: "my_project:src/git/gitService.ts",
            path: "src/git/gitService.ts",
          },
        ],
        rules: [
          {
            key: "typescript:S1128",
            htmlNote: "<p>Unused imports add noise and should be removed.</p>",
          },
        ],
      }));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info", "--json"]);

    const parsed = JSON.parse(out.stdout) as {
      sonarFailures?: {
        status: string;
        qualityGateStatus?: string;
        gateViolations: Array<{ metricKey: string }>;
        issues: Array<{ path?: string; line?: number | null; explanation?: string }>;
      };
    };

    expect(parsed.sonarFailures?.status).toBe("available");
    expect(parsed.sonarFailures?.qualityGateStatus).toBe("ERROR");
    expect(parsed.sonarFailures?.gateViolations[0]?.metricKey).toBe("new_security_hotspots_reviewed");
    expect(parsed.sonarFailures?.issues[0]).toMatchObject({
      path: "src/git/gitService.ts",
      line: 8,
      explanation: "Unused imports add noise and should be removed.",
    });
  });

  it("JSON output includes a private-project sonarFailures note when SonarCloud returns 401", async () => {
    const sonarUrl = "https://sonarcloud.io/summary/new_code?id=my_project&pullRequest=42";
    const pr = {
      ...MERGED_PR,
      statusCheckRollup: [
        {
          name: "SonarCloud Code Analysis",
          status: "COMPLETED",
          conclusion: "FAILURE",
          description: "Quality Gate failed",
          detailsUrl: sonarUrl,
        },
      ],
    };
    const [remote, api] = noEnrichment();
    mockSpawnSync
      .mockReturnValueOnce(ok("feature/my-branch\n"))
      .mockReturnValueOnce(ok(JSON.stringify(pr)))
      .mockReturnValueOnce(remote)
      .mockReturnValueOnce(api);

    fetchMock
      .mockResolvedValueOnce(fetchError(401))
      .mockResolvedValueOnce(fetchError(401))
      .mockResolvedValueOnce(fetchError(401));

    const { gitCommand } = await import("../../src/commands/git.js");
    await gitCommand.parseAsync(["node", "git", "get-pr-info", "--json"]);

    const parsed = JSON.parse(out.stdout) as {
      sonarFailures?: {
        status: string;
        privateMessage?: string;
      };
    };

    expect(parsed.sonarFailures?.status).toBe("private");
    expect(parsed.sonarFailures?.privateMessage).toContain("authenticated browser");
  });
});
