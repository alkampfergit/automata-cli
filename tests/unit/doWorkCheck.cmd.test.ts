import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IssueSurface } from "../../src/github/ghWorkService.js";
import type { RawMessage } from "../../src/github/conversation.js";
import type { LogReadResult, ExecutionTick, WorkRecord } from "../../src/run/operationLog.js";
import type { RepoStatus } from "../../src/git/repoStatus.js";

/* ── mocks ──────────────────────────────────────────────────────────────── */

const mockReadConfig = vi.fn();

const gh = {
  listCandidateIssues: vi.fn(),
  getIssueSurface: vi.fn(),
  getOpenPrLinkMap: vi.fn(),
  getPrSurface: vi.fn(),
  getRepoSlug: vi.fn(),
  getAuthenticatedLogin: vi.fn(),
  getAuthenticatedIdentity: vi.fn(),
  // Every write `do-work` can perform. The check must call none of them, and
  // the only way to know that is to have them here and assert zero calls.
  assignIssueToAgent: vi.fn(),
  assignPrToAgent: vi.fn(),
  postMarker: vi.fn(),
  updateMarker: vi.fn(),
  deleteMarker: vi.fn(),
};

const mockAcquireRunLock = vi.fn();
const mockInspectRunLock = vi.fn();
const mockRecordTick = vi.fn();
const mockInspectLogDirectory = vi.fn();
const mockReadExecutionTicks = vi.fn();
const mockReadWorkRecords = vi.fn();
const mockInspectRepoStatus = vi.fn();
const mockRunRepoHygiene = vi.fn();
const mockPrepareBaseBranch = vi.fn();
const mockPreparePrBranch = vi.fn();
const mockAddClosesRefToPr = vi.fn();
const mockGetCurrentBranchPr = vi.fn();
const mockRunClaude = vi.fn();
const mockRunCodex = vi.fn();
const mockResolveCommand = vi.fn();

vi.mock("../../src/config/configStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/configStore.js")>();
  return { ...actual, readConfig: () => mockReadConfig() };
});

vi.mock("../../src/github/ghWorkService.js", () => ({
  listCandidateIssues: (...a: unknown[]) => gh.listCandidateIssues(...a),
  getIssueSurface: (...a: unknown[]) => gh.getIssueSurface(...a),
  getOpenPrLinkMap: (...a: unknown[]) => gh.getOpenPrLinkMap(...a),
  getPrSurface: (...a: unknown[]) => gh.getPrSurface(...a),
  getRepoSlug: () => gh.getRepoSlug(),
  getAuthenticatedLogin: () => gh.getAuthenticatedLogin(),
  getAuthenticatedIdentity: () => gh.getAuthenticatedIdentity(),
  assignIssueToAgent: (...a: unknown[]) => gh.assignIssueToAgent(...a),
  assignPrToAgent: (...a: unknown[]) => gh.assignPrToAgent(...a),
  postMarker: (...a: unknown[]) => gh.postMarker(...a),
  updateMarker: (...a: unknown[]) => gh.updateMarker(...a),
  deleteMarker: (...a: unknown[]) => gh.deleteMarker(...a),
}));

vi.mock("../../src/run/runLock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/run/runLock.js")>();
  return {
    ...actual,
    acquireRunLock: (...a: unknown[]) => mockAcquireRunLock(...a),
    inspectRunLock: (...a: unknown[]) => mockInspectRunLock(...a),
  };
});

vi.mock("../../src/run/operationLog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/run/operationLog.js")>();
  return {
    ...actual,
    recordTick: (...a: unknown[]) => mockRecordTick(...a),
    readExecutionTicks: (...a: unknown[]) => mockReadExecutionTicks(...a),
    readWorkRecords: (...a: unknown[]) => mockReadWorkRecords(...a),
    // Stubbed because the real one probes `dirname(process.cwd())`, which is the
    // repository's own parent — read-only in CI and in the dev container, so
    // every check here would otherwise report an unwritable log directory.
    inspectLogDirectory: (...a: unknown[]) => mockInspectLogDirectory(...a),
  };
});

vi.mock("../../src/git/repoStatus.js", () => ({
  inspectRepoStatus: (...a: unknown[]) => mockInspectRepoStatus(...a),
}));

vi.mock("../../src/git/repoHygiene.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/git/repoHygiene.js")>();
  return { ...actual, runRepoHygiene: (...a: unknown[]) => mockRunRepoHygiene(...a) };
});

vi.mock("../../src/git/workspaceService.js", () => ({
  prepareBaseBranch: (...a: unknown[]) => mockPrepareBaseBranch(...a),
  preparePrBranch: (...a: unknown[]) => mockPreparePrBranch(...a),
}));

vi.mock("../../src/git/gitService.js", () => ({
  getCurrentBranch: () => "develop",
}));

vi.mock("../../src/config/githubService.js", () => ({
  getCurrentBranchPr: (...a: unknown[]) => mockGetCurrentBranchPr(...a),
  addClosesRefToPr: (...a: unknown[]) => mockAddClosesRefToPr(...a),
}));

vi.mock("../../src/claude/claudeService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/claude/claudeService.js")>();
  return { ...actual, runClaude: (...a: unknown[]) => mockRunClaude(...a) };
});

// `resolveCommand` is stubbed rather than left real. The environment section's
// "is the executor on PATH" answer is under test, and with the real lookup the
// answer would be whatever happens to be installed on the machine running the
// suite — green on a developer box with Claude Code installed, red on CI.
vi.mock("../../src/cli/spawnUtils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cli/spawnUtils.js")>();
  return { ...actual, resolveCommand: (name: string) => mockResolveCommand(name) as string };
});

vi.mock("../../src/codex/codexService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/codex/codexService.js")>();
  return { ...actual, runCodex: (...a: unknown[]) => mockRunCodex(...a) };
});

/* ── fixtures ───────────────────────────────────────────────────────────── */

const CONFIG = {
  remoteType: "gh",
  issueDiscoveryTechnique: "label",
  issueDiscoveryValue: "automated",
  allowedUsers: ["alice"],
  agentUser: "automata-bot",
};

function message(
  author: string,
  createdAt: string,
  kind: RawMessage["kind"] = "issue-comment",
): RawMessage {
  return { kind, author, body: `${author}@${createdAt}`, createdAt };
}

/** An issue with a new authorized message the agent has not answered. */
function needsWork(number: number): IssueSurface {
  return {
    issue: {
      number,
      title: `Issue ${String(number)}`,
      body: "please",
      url: `https://gh/i/${String(number)}`,
    },
    state: "OPEN",
    assignees: [],
    labels: ["automated"],
    messages: [message("alice", "2026-01-01T00:00:00Z", "issue-body")],
  };
}

/** The same issue after the agent answered: the tick would skip it. */
function settled(number: number): IssueSurface {
  return {
    ...needsWork(number),
    messages: [
      message("alice", "2026-01-01T00:00:00Z", "issue-body"),
      message("automata-bot", "2026-01-02T00:00:00Z"),
    ],
  };
}

function prRef(number: number, title: string) {
  return {
    number,
    url: `https://gh/p/${String(number)}`,
    title,
    headRefName: `feature/${String(number)}`,
    baseRefName: "develop",
    isCrossRepository: false,
    state: "OPEN" as const,
    isDraft: false,
    updatedAt: "2026-01-02T00:00:00Z",
  };
}

/** An orphan pull request with nothing new on it: selected, then skipped. */
function orphanPrSurface(number: number) {
  return {
    pr: prRef(number, `PR ${String(number)}`),
    assignees: [],
    messages: [message("automata-bot", "2026-01-02T00:00:00Z", "pr-comment")],
    threads: [],
  };
}

function emptyRead<T>(): LogReadResult<T> {
  return {
    entries: [],
    present: true,
    error: null,
    skipped: 0,
    otherRepos: 0,
    filtered: true,
    path: "/w/log",
  };
}

function cleanRepoStatus(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    branch: "develop",
    head: "abc1234",
    dirtyPaths: [],
    statusError: null,
    baseBranch: "develop",
    baseLocal: true,
    upstream: "origin/develop",
    upstreamTracked: true,
    ahead: 0,
    behind: 0,
    refreshed: true,
    fetchError: null,
    error: null,
    ...overrides,
  };
}

/* ── harness ────────────────────────────────────────────────────────────── */

let stdout = "";
let stderr = "";
let exitCode: number | undefined;

class ExitError extends Error {}

async function runCheck(args: string[] = []): Promise<void> {
  const { doWorkCommand } = await import("../../src/commands/doWork.js");
  try {
    await doWorkCommand.parseAsync(["node", "automata", "--check", ...args]);
  } catch (err) {
    if (!(err instanceof ExitError)) throw err;
  }
}

/** Nothing was written — anywhere. The contract this whole command rests on. */
function expectNothingWritten(): void {
  expect(mockAcquireRunLock).not.toHaveBeenCalled();
  expect(mockRecordTick).not.toHaveBeenCalled();
  expect(mockRunRepoHygiene).not.toHaveBeenCalled();
  expect(mockPrepareBaseBranch).not.toHaveBeenCalled();
  expect(mockPreparePrBranch).not.toHaveBeenCalled();
  expect(mockAddClosesRefToPr).not.toHaveBeenCalled();
  expect(mockRunClaude).not.toHaveBeenCalled();
  expect(mockRunCodex).not.toHaveBeenCalled();
  for (const write of [
    gh.assignIssueToAgent,
    gh.assignPrToAgent,
    gh.postMarker,
    gh.updateMarker,
    gh.deleteMarker,
  ]) {
    expect(write).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  stdout = "";
  stderr = "";
  exitCode = undefined;
  vi.clearAllMocks();

  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new ExitError(`exit ${String(code)}`);
  }) as never);

  mockReadConfig.mockReturnValue({ ...CONFIG });
  gh.getRepoSlug.mockReturnValue({ owner: "acme", repo: "widgets" });
  gh.getAuthenticatedLogin.mockReturnValue("automata-bot");
  gh.getAuthenticatedIdentity.mockReturnValue({ kind: "login", login: "automata-bot" });
  gh.listCandidateIssues.mockReturnValue([]);
  gh.getOpenPrLinkMap.mockReturnValue({
    byIssue: new Map(),
    orphans: [],
    defaultBranch: "develop",
  });
  mockInspectRunLock.mockReturnValue({ kind: "free" });
  mockInspectLogDirectory.mockReturnValue({
    dir: "/srv/checkouts",
    cwd: "/srv/checkouts/widgets",
    writable: true,
    detail: null,
  });
  mockReadExecutionTicks.mockReturnValue(emptyRead<ExecutionTick>());
  mockReadWorkRecords.mockReturnValue(emptyRead<WorkRecord>());
  mockInspectRepoStatus.mockReturnValue(cleanRepoStatus());
  // The executor is installed unless a test says otherwise.
  mockResolveCommand.mockImplementation((name: string) => `/usr/local/bin/${name}`);
});

/* ── tests ──────────────────────────────────────────────────────────────── */

describe("do-work --check", () => {
  it("prints every section in order and never writes anything", async () => {
    // One healthy tick history, so the ticks section has nothing to complain about.
    mockReadExecutionTicks.mockReturnValue({
      ...emptyRead<ExecutionTick>(),
      entries: [
        {
          timestamp: new Date(),
          command: "do-work",
          repo: "acme/widgets",
          items: 0,
          counts: { answered: 0, "answered-no-reply": 0, skipped: 0, failed: 0, deferred: 0 },
          runs: 0,
          exitCode: 0,
          durationSeconds: 1,
          note: null,
        },
      ],
    });

    await runCheck();

    const order = [
      "Run lock",
      "Recent ticks",
      "Last work",
      "Repository",
      "Selection",
      "Environment",
    ];
    let cursor = -1;
    for (const heading of order) {
      const at = stdout.indexOf(heading);
      expect(at, heading).toBeGreaterThan(cursor);
      cursor = at;
    }
    expectNothingWritten();
  });

  it("refuses --check together with --dry-run", async () => {
    await runCheck(["--dry-run"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("two different read-only reports");
    // Refused before anything was read, let alone written.
    expect(mockInspectRunLock).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("exits 0 and says healthy when nothing is wrong", async () => {
    mockReadExecutionTicks.mockReturnValue({
      ...emptyRead<ExecutionTick>(),
      entries: [
        {
          timestamp: new Date(),
          command: "do-work",
          repo: "acme/widgets",
          items: 0,
          counts: { answered: 0, "answered-no-reply": 0, skipped: 0, failed: 0, deferred: 0 },
          runs: 0,
          exitCode: 0,
          durationSeconds: 1,
          note: null,
        },
      ],
    });

    await runCheck();

    expect(stdout).toContain("RESULT: healthy");
    expect(stdout).toContain("default executor: claude (/usr/local/bin/claude)");
    expect(exitCode).toBeUndefined();
  });

  it("reports an executor that is not on PATH as a problem", async () => {
    // What `resolveCommand` returns when nothing on PATH matches: the bare name.
    mockResolveCommand.mockImplementation((name: string) => name);

    await runCheck();

    expect(stdout).toContain("default executor: claude (not found on PATH)");
    expect(stdout).toContain("is not on PATH, so every run this tick would fail");
    expect(exitCode).toBe(1);
  });

  it("exits 1 and counts the problems when something is wrong", async () => {
    mockInspectRepoStatus.mockReturnValue(cleanRepoStatus({ dirtyPaths: [" M src/a.ts"] }));

    await runCheck();

    expect(stdout).toContain("RESULT:");
    expect(stdout).toContain("problem(s) found");
    expect(exitCode).toBe(1);
  });

  it("runs the real selection path and reports each candidate's fate", async () => {
    gh.listCandidateIssues.mockReturnValue([
      { number: 42, title: "Needs work", body: "", url: "https://gh/i/42" },
      { number: 43, title: "Already answered", body: "", url: "https://gh/i/43" },
    ]);
    gh.getIssueSurface.mockImplementation((n: number) => (n === 42 ? needsWork(42) : settled(43)));

    await runCheck();

    expect(stdout).toContain("1 of 2 candidate(s) would be picked up");
    expect(stdout).toContain("#42");
    expect(stdout).toContain("#43 nothing to do —");
    expectNothingWritten();
  });

  it("confines a gh failure to the selection section and still prints the rest", async () => {
    gh.listCandidateIssues.mockImplementation(() => {
      throw new Error("gh: API rate limit exceeded");
    });

    await runCheck();

    expect(stdout).toContain("could not be computed: gh: API rate limit exceeded");
    // The other sections still ran.
    expect(stdout).toContain("Run lock");
    expect(stdout).toContain("Environment");
    expect(exitCode).toBe(1);
  });

  it("reports an invalid configuration as a finding rather than dying on it", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { maxRunsPerTick: "three" } });

    await runCheck();

    expect(stdout).toContain("configuration is not usable");
    expect(stdout).toContain("doWork.maxRunsPerTick");
    // Everything that does not depend on the configuration still printed.
    expect(stdout).toContain("Run lock");
    expect(stdout).toContain("Repository");
    expect(stdout).toContain("Selection");
    expect(exitCode).toBe(1);
  });

  it("falls back to the default base branch when the configuration cannot be read", async () => {
    mockReadConfig.mockImplementation(() => {
      throw new Error("no .automata/config.json here");
    });

    await runCheck();

    // Without a fallback the git section could not run at all, which is the one
    // section most likely to explain a broken checkout.
    expect(mockInspectRepoStatus).toHaveBeenCalledWith({ baseBranch: "develop", fetch: true });
    expect(stdout).toContain("no .automata/config.json here");
  });

  it("makes no network call at all with --no-fetch", async () => {
    await runCheck(["--no-fetch"]);

    expect(mockInspectRepoStatus).toHaveBeenCalledWith({ baseBranch: "develop", fetch: false });
    expect(gh.listCandidateIssues).not.toHaveBeenCalled();
    expect(gh.getOpenPrLinkMap).not.toHaveBeenCalled();
    expect(gh.getAuthenticatedLogin).not.toHaveBeenCalled();
    expect(gh.getAuthenticatedIdentity).not.toHaveBeenCalled();
    expect(stdout).toContain("--no-fetch makes no network call");
  });

  it("does not turn --no-fetch's skipped selection into a problem", async () => {
    mockReadExecutionTicks.mockReturnValue({
      ...emptyRead<ExecutionTick>(),
      entries: [
        {
          timestamp: new Date(),
          command: "do-work",
          repo: "acme/widgets",
          items: 0,
          counts: { answered: 0, "answered-no-reply": 0, skipped: 0, failed: 0, deferred: 0 },
          runs: 0,
          exitCode: 0,
          durationSeconds: 1,
          note: null,
        },
      ],
    });

    await runCheck(["--no-fetch"]);

    expect(stdout).toContain("RESULT: healthy");
  });

  it("narrows the selection to one issue with --issue", async () => {
    gh.listCandidateIssues.mockReturnValue([
      { number: 42, title: "a", body: "", url: "u" },
      { number: 43, title: "b", body: "", url: "u" },
    ]);
    gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));

    await runCheck(["--issue", "43"]);

    expect(stdout).toContain("of 1 candidate(s)");
    expect(stdout).toContain("#43");
    expect(stdout).not.toContain("#42");
  });

  it("reports a self-triggering `gh` identity as a problem instead of exiting", async () => {
    gh.getAuthenticatedIdentity.mockReturnValue({ kind: "login", login: "alice" });

    await runCheck();

    expect(stdout).toContain("listed in allowedUsers");
    // A tick would have exited here; the report keeps going and still prints
    // the section that explains the consequence.
    expect(stdout).toContain("Selection");
    expect(exitCode).toBe(1);
  });

  it("reports an unresolvable repository slug as a problem", async () => {
    gh.getRepoSlug.mockImplementation(() => {
      throw new Error("no origin remote");
    });

    await runCheck();

    expect(stdout).toContain("repository slug could not be resolved");
    expect(exitCode).toBe(1);
  });

  it("names the running tick from the lock file", async () => {
    mockInspectRunLock.mockReturnValue({
      kind: "held",
      owner: {
        pid: 4242,
        startedAt: "2026-01-10T00:00:00Z",
        host: "build-01",
        command: "do-work",
        token: "t",
      },
      heldForMs: 90_000,
    });

    await runCheck();

    expect(stdout).toContain("a tick is running");
    expect(stdout).toContain("pid 4242 on build-01");
    // `pgrep` is what the check deliberately does not do: the lock file is read,
    // never the process table.
    expect(mockInspectRunLock).toHaveBeenCalledWith(120);
  });

  it("filters the operation logs to this repository", async () => {
    await runCheck();

    expect(mockReadExecutionTicks).toHaveBeenCalledWith({ repo: "acme/widgets", limit: 20 });
    expect(mockReadWorkRecords).toHaveBeenCalledWith({ repo: "acme/widgets", limit: 3 });
  });

  it("emits one parseable JSON document with --json", async () => {
    mockInspectRepoStatus.mockReturnValue(cleanRepoStatus({ dirtyPaths: [" M a.ts"] }));

    await runCheck(["--json"]);

    const parsed = JSON.parse(stdout) as {
      exitCode: number;
      repo: string;
      offline: boolean;
      problems: { section: string; summary: string }[];
      sections: Record<string, { data: Record<string, unknown> }>;
    };
    expect(parsed.exitCode).toBe(1);
    expect(parsed.repo).toBe("acme/widgets");
    expect(parsed.offline).toBe(false);
    expect(Object.keys(parsed.sections)).toEqual([
      "lock",
      "ticks",
      "work",
      "git",
      "selection",
      "environment",
    ]);
    expect(parsed.problems.some((problem) => problem.section === "git")).toBe(true);
    expect(parsed.sections["git"].data["dirtyPaths"]).toEqual([" M a.ts"]);
    expect(exitCode).toBe(1);
  });

  it("carries the plan into --json in the same shape as --dry-run --json", async () => {
    gh.listCandidateIssues.mockReturnValue([{ number: 42, title: "a", body: "", url: "u" }]);
    gh.getIssueSurface.mockReturnValue(needsWork(42));

    await runCheck(["--json"]);

    const parsed = JSON.parse(stdout) as {
      sections: Record<string, { data: { plan: Record<string, unknown>[] } }>;
    };
    const plan = parsed.sections["selection"].data.plan;
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ issue: 42, turn: "issue-discuss" });
  });
  it("reports an unauthenticated `gh` instead of calling it an app token", async () => {
    // `getAuthenticatedLogin` answers null for an app installation token *and*
    // for a `gh` that is not logged in. Only the second stops the loop, and it
    // used to be reported as the first — i.e. not reported at all.
    gh.getAuthenticatedIdentity.mockReturnValue({
      kind: "unavailable",
      detail: "gh: Not Found (HTTP 404)",
    });

    await runCheck();

    expect(stdout).toContain("`gh` could not name an account");
    expect(stdout).toContain("gh auth login");
    expect(exitCode).toBe(1);
  });

  it("accepts an app installation token, which has no account, without a problem", async () => {
    gh.getAuthenticatedIdentity.mockReturnValue({ kind: "no-user" });

    await runCheck();

    expect(stdout).toContain("an app installation token has none");
    expect(stdout).not.toContain("could not name an account");
    expect(stdout).not.toContain("gh auth login");
  });

  it("queries `gh` for its identity exactly once", async () => {
    // The identity was read twice — once for the line, once inside
    // `describeIdentityProblem` — and the second call wrote a warning to stderr
    // on an otherwise healthy check.
    await runCheck();

    expect(gh.getAuthenticatedIdentity).toHaveBeenCalledTimes(1);
    expect(gh.getAuthenticatedLogin).not.toHaveBeenCalled();
    expect(stderr).not.toContain("could not determine which account");
  });

  it("reports an invalid --effort instead of exiting on it", async () => {
    // `resolveEffortOption` exits the process; a diagnostic that dies before
    // printing a section is no diagnostic.
    await runCheck(["--effort", "  "]);

    expect(stdout).toContain("--effort must be a non-empty level");
    expect(stdout).toContain("Run lock");
    expect(exitCode).toBe(1);
  });

  it("says when the operation logs were not filtered by repository", async () => {
    gh.getRepoSlug.mockImplementation(() => {
      throw new Error("no origin remote");
    });
    mockReadExecutionTicks.mockReturnValue({ ...emptyRead<ExecutionTick>(), filtered: false });
    mockReadWorkRecords.mockReturnValue({ ...emptyRead<WorkRecord>(), filtered: false });

    await runCheck();

    // Without the slug the readers keep every checkout's entries; presenting
    // them as this repository's history is the wrong answer to "why has *this*
    // checkout done nothing".
    expect(stdout).toContain("not filtered by repository");
  });

  it("publishes remoteType and ghAvailable in --json, as the contract says", async () => {
    await runCheck(["--json"]);

    const parsed = JSON.parse(stdout) as {
      sections: Record<string, { data: Record<string, unknown> }>;
    };
    expect(parsed.sections["environment"].data["remoteType"]).toBe("gh");
    expect(parsed.sections["environment"].data["ghAvailable"]).toBe(true);
  });

  it("publishes ghAvailable as false when `gh` could not name an account", async () => {
    gh.getAuthenticatedIdentity.mockReturnValue({ kind: "unavailable", detail: "not logged in" });

    await runCheck(["--json"]);

    const parsed = JSON.parse(stdout) as {
      sections: Record<string, { data: Record<string, unknown> }>;
    };
    expect(parsed.sections["environment"].data["ghAvailable"]).toBe(false);
  });
});

describe("do-work --check --verbose", () => {
  it("lists every git and gh invocation with a duration and an exit code", async () => {
    // The real `spawnSync` wrappers are mocked out in this suite, so the trace
    // is driven through the sink the way they drive it — which is the contract
    // that matters: the report renders whatever was recorded.
    const { recordCommand } = await import("../../src/run/commandTrace.js");
    mockInspectRepoStatus.mockImplementation(() => {
      recordCommand("git", ["rev-parse", "--short", "HEAD"], Date.now(), 0);
      recordCommand("git", ["fetch", "origin"], Date.now(), 1);
      return cleanRepoStatus();
    });

    await runCheck(["--verbose"]);

    expect(stdout).toContain("Commands (2)");
    expect(stdout).toMatch(/git rev-parse --short HEAD — \d+ms exit 0/);
    expect(stdout).toMatch(/git fetch origin — \d+ms exit 1/);
  });

  it("records nothing and prints no command block without --verbose", async () => {
    const { recordCommand } = await import("../../src/run/commandTrace.js");
    mockInspectRepoStatus.mockImplementation(() => {
      recordCommand("git", ["status"], Date.now(), 0);
      return cleanRepoStatus();
    });

    await runCheck();

    expect(stdout).not.toContain("Commands (");
    expect(stdout).not.toContain("git status");
  });

  it("states the discovery query as sent and every candidate considered", async () => {
    gh.listCandidateIssues.mockReturnValue([settled(42).issue, settled(43).issue]);
    gh.getIssueSurface.mockImplementation((n: number) => settled(n));
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map(),
      defaultBranch: "develop",
      // One that the discovery filter keeps and one it drops, so the line that
      // says which is which cannot pass by printing them all the same.
      orphans: [
        { pr: prRef(61, "Bump deps"), labels: ["automated"], assignees: [] },
        { pr: prRef(62, "Unrelated"), labels: [], assignees: [] },
      ],
    });
    gh.getPrSurface.mockImplementation((n: number) => orphanPrSurface(n));

    await runCheck(["--verbose"]);

    expect(stdout).toContain("discovery query: label = automated, limit 10");
    expect(stdout).toContain("discovery returned 2 issue(s):");
    expect(stdout).toContain("#42 Issue 42");
    expect(stdout).toContain("2 open orphan pull request(s) considered:");
    expect(stdout).toContain("PR #61 Bump deps — matches the filter");
    expect(stdout).toContain("PR #62 Unrelated — dropped by the discovery filter");
  });

  it("carries the trace as a top-level array in the JSON payload", async () => {
    const { recordCommand } = await import("../../src/run/commandTrace.js");
    mockInspectRepoStatus.mockImplementation(() => {
      recordCommand("git", ["status", "--porcelain"], Date.now(), 0);
      return cleanRepoStatus();
    });

    await runCheck(["--verbose", "--json"]);

    const payload = JSON.parse(stdout) as { trace: { command: string; args: string[] }[] | null };
    expect(payload.trace).not.toBeNull();
    expect(payload.trace?.some((entry) => entry.args.includes("--porcelain"))).toBe(true);
  });

  it("emits a null trace when --verbose was not given", async () => {
    await runCheck(["--json"]);
    expect((JSON.parse(stdout) as { trace: unknown }).trace).toBeNull();
  });

  it("is still read-only with --verbose", async () => {
    await runCheck(["--verbose"]);
    expectNothingWritten();
  });
});

describe("do-work --check — where it looked", () => {
  it("always names the log directory, its derivation and its writability", async () => {
    await runCheck();
    expect(stdout).toContain(
      "log directory: /srv/checkouts (the parent of the working directory /srv/checkouts/widgets), writable",
    );
  });

  it("flags a log directory a tick cannot write to, with the command that shows why", async () => {
    mockInspectLogDirectory.mockReturnValue({
      dir: "/srv/checkouts",
      cwd: "/srv/checkouts/widgets",
      writable: false,
      detail: "EACCES: permission denied",
    });

    await runCheck();

    expect(stdout).toContain("not writable: EACCES");
    expect(stdout).toContain("try: ls -ld /srv/checkouts");
    expect(exitCode).toBe(1);
  });

  it("does not report a problem for a first tick still in flight", async () => {
    // The paste in issue #82: a live pid beside "no execution log", exit 1.
    mockInspectRunLock.mockReturnValue({
      kind: "held",
      owner: {
        pid: 851554,
        startedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
        host: "cisharpai",
        command: "do-work",
        token: "tok",
        cwd: "/srv/checkouts/widgets",
      },
      heldForMs: 4 * 60 * 1000,
      heartbeat: null,
    });
    mockReadExecutionTicks.mockReturnValue({
      ...emptyRead<ExecutionTick>(),
      present: false,
    });

    await runCheck();

    expect(stdout).toContain("RESULT: healthy");
    expect(stdout).toContain("has not recorded itself yet");
    expect(exitCode).toBeUndefined();
  });

  it("flags a holder that logs somewhere this check is not reading", async () => {
    mockInspectRunLock.mockReturnValue({
      kind: "held",
      owner: {
        pid: 851554,
        startedAt: new Date().toISOString(),
        host: "cisharpai",
        command: "do-work",
        token: "tok",
        cwd: "/home/ci/widgets",
      },
      heldForMs: 1000,
      heartbeat: null,
    });

    await runCheck();

    expect(stdout).toContain("logs to /home/ci (this check reads /srv/checkouts)");
    expect(exitCode).toBe(1);
  });

  it("renders the live tick's heartbeat under the lock", async () => {
    mockInspectRunLock.mockReturnValue({
      kind: "held",
      owner: {
        pid: 851554,
        startedAt: new Date().toISOString(),
        host: "cisharpai",
        command: "do-work",
        token: "tok",
        cwd: "/srv/checkouts/widgets",
      },
      heldForMs: 1000,
      heartbeat: {
        token: "tok",
        updatedAt: new Date().toISOString(),
        phase: "item",
        item: { index: 3, total: 8, subject: "#82" },
        executor: { command: "claude", startedAt: new Date(Date.now() - 120_000).toISOString() },
      },
    });

    await runCheck();

    expect(stdout).toContain("phase: item — item 3 of 8, #82");
    expect(stdout).toContain("executor: claude, running for 2m");
  });
});
