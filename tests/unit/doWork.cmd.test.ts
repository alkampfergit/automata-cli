import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IssueSurface, PrSurface, PullRequestRef } from "../../src/github/ghWorkService.js";
import type { RawMessage } from "../../src/github/conversation.js";

/* ── mocks ──────────────────────────────────────────────────────────────── */

const mockReadConfig = vi.fn();
const gh = {
  listCandidateIssues: vi.fn(),
  getIssueSurface: vi.fn(),
  getOpenPrLinkMap: vi.fn(),
  getPrSurface: vi.fn(),
  assignIssueToAgent: vi.fn(),
  assignPrToAgent: vi.fn(),
  postMarker: vi.fn(),
  updateMarker: vi.fn(),
  deleteMarker: vi.fn(),
  getRepoSlug: vi.fn(),
  getAuthenticatedLogin: vi.fn(),
};
const mockGetCurrentBranchPr = vi.fn();
const mockAddClosesRefToPr = vi.fn();
const mockPrepareBaseBranch = vi.fn();
const mockPreparePrBranch = vi.fn();
const mockAcquireRunLock = vi.fn();
const mockRecordTick = vi.fn();
const mockRelease = vi.fn();
const mockInvokeClaude = vi.fn();
const mockInvokeCodex = vi.fn();

vi.mock("../../src/config/configStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/configStore.js")>();
  return { ...actual, readConfig: () => mockReadConfig() };
});

vi.mock("../../src/github/ghWorkService.js", () => ({
  listCandidateIssues: (...a: unknown[]) => gh.listCandidateIssues(...a),
  getIssueSurface: (...a: unknown[]) => gh.getIssueSurface(...a),
  getOpenPrLinkMap: (...a: unknown[]) => gh.getOpenPrLinkMap(...a),
  getPrSurface: (...a: unknown[]) => gh.getPrSurface(...a),
  assignIssueToAgent: (...a: unknown[]) => gh.assignIssueToAgent(...a),
  assignPrToAgent: (...a: unknown[]) => gh.assignPrToAgent(...a),
  postMarker: (...a: unknown[]) => gh.postMarker(...a),
  updateMarker: (...a: unknown[]) => gh.updateMarker(...a),
  deleteMarker: (...a: unknown[]) => gh.deleteMarker(...a),
  getRepoSlug: () => gh.getRepoSlug(),
  getAuthenticatedLogin: () => gh.getAuthenticatedLogin(),
}));

vi.mock("../../src/config/githubService.js", () => ({
  getCurrentBranchPr: (...a: unknown[]) => mockGetCurrentBranchPr(...a),
  addClosesRefToPr: (...a: unknown[]) => mockAddClosesRefToPr(...a),
}));

const mockGetCurrentBranch = vi.fn();

vi.mock("../../src/git/gitService.js", () => ({
  getCurrentBranch: () => mockGetCurrentBranch(),
}));

vi.mock("../../src/git/workspaceService.js", () => ({
  prepareBaseBranch: (...a: unknown[]) => mockPrepareBaseBranch(...a),
  preparePrBranch: (...a: unknown[]) => mockPreparePrBranch(...a),
}));

const mockRunRepoHygiene = vi.fn();

// The pre-flight has its own suite (repoHygiene.test.ts); here it is mocked so
// these tests assert only what the command does with its report.
vi.mock("../../src/git/repoHygiene.js", () => ({
  runRepoHygiene: (...a: unknown[]) => mockRunRepoHygiene(...a),
}));

const CLEAN_HYGIENE = {
  rescue: { kind: "clean" },
  base: { ok: true },
  prunes: [],
  degraded: false,
};

vi.mock("../../src/run/runLock.js", () => ({
  acquireRunLock: (...a: unknown[]) => mockAcquireRunLock(...a),
}));

// Stubbed rather than pointed at a temp directory: the real module writes to
// the *parent* of the working directory, so an unmocked test run would litter
// the directory above the checkout on any machine where it is writable.
vi.mock("../../src/run/operationLog.js", () => ({
  recordTick: (...a: unknown[]) => mockRecordTick(...a),
}));

vi.mock("../../src/claude/claudeService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/claude/claudeService.js")>();
  return {
    ...actual,
    // Only the spawn is stubbed; buildClaudeArgs and resolveCommand stay real so
    // the dry-run tests exercise the same argv builder the real run uses.
    runClaude: (...a: unknown[]) => mockInvokeClaude(...a),
  };
});

vi.mock("../../src/codex/codexService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/codex/codexService.js")>();
  return { ...actual, runCodex: (...a: unknown[]) => mockInvokeCodex(...a) };
});

/* ── fixtures ───────────────────────────────────────────────────────────── */

const CONFIG = {
  remoteType: "gh",
  issueDiscoveryTechnique: "label",
  issueDiscoveryValue: "automated",
  allowedUsers: ["alice"],
  agentUser: "automata-bot",
};

const MARKER = { commentId: "999", createdAt: "2026-01-10T00:00:00Z" };

function issue(number: number, title = `Issue ${String(number)}`) {
  return { number, title, body: "please", url: `https://gh/i/${String(number)}` };
}

function message(author: string, createdAt: string, kind: RawMessage["kind"] = "issue-comment"): RawMessage {
  return { kind, author, body: `${author}@${createdAt}`, createdAt };
}

/** An issue surface with a new authorized message and no agent reply. */
function needsWork(number: number, assignees: string[] = []): IssueSurface {
  return {
    issue: issue(number),
    state: "OPEN",
    assignees,
    labels: ["automated"],
    messages: [message("alice", "2026-01-01T00:00:00Z", "issue-body")],
  };
}

/** The same issue after the agent has posted its answer. */
function answered(number: number): IssueSurface {
  return {
    ...needsWork(number),
    messages: [
      message("alice", "2026-01-01T00:00:00Z", "issue-body"),
      message("automata-bot", "2026-01-10T00:05:00Z"),
    ],
  };
}

/**
 * Model the agent answering: the surface reads as answered once the marker has
 * been posted. Expressed as a condition rather than a call-count sequence, so it
 * survives the extra pre-run refresh read.
 */
function answersAfterMarker(): void {
  gh.getIssueSurface.mockImplementation((n: number) =>
    gh.postMarker.mock.calls.length > 0 ? answered(n) : needsWork(n),
  );
}

/** An issue surface where the agent has already answered. */
function settled(number: number): IssueSurface {
  return {
    issue: issue(number),
    state: "OPEN",
    assignees: ["automata-bot"],
    labels: ["automated"],
    messages: [
      message("alice", "2026-01-01T00:00:00Z", "issue-body"),
      message("automata-bot", "2026-01-02T00:00:00Z"),
    ],
  };
}

const PR: PullRequestRef = {
  number: 57,
  url: "https://gh/pr/57",
  title: "Flag",
  headRefName: "feature/042",
  baseRefName: "develop",
  isCrossRepository: false,
  state: "OPEN",
  isDraft: false,
  updatedAt: "2026-01-05T00:00:00Z",
};

function prSurface(overrides: Partial<PrSurface> = {}): PrSurface {
  return { pr: PR, assignees: [], messages: [], threads: [], ...overrides };
}

/* ── harness ────────────────────────────────────────────────────────────── */

let stdout = "";
let stderr = "";
let exitCode: number | undefined;

class ExitError extends Error {}

function captureIo(): void {
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
}

async function runDoWork(args: string[] = []): Promise<void> {
  const { doWorkCommand } = await import("../../src/commands/doWork.js");
  try {
    await doWorkCommand.parseAsync(["node", "automata", ...args]);
  } catch (err) {
    if (!(err instanceof ExitError)) throw err;
  }
}

beforeEach(() => {
  stdout = "";
  stderr = "";
  exitCode = undefined;
  vi.clearAllMocks();
  captureIo();

  mockReadConfig.mockReturnValue({ ...CONFIG });
  mockAcquireRunLock.mockReturnValue({ ok: true, handle: { release: mockRelease } });
  gh.getRepoSlug.mockReturnValue({ owner: "acme", repo: "widget" });
  gh.getAuthenticatedLogin.mockReturnValue("automata-bot");
  gh.getOpenPrLinkMap.mockReturnValue({ byIssue: new Map(), defaultBranch: "main", orphans: [] });
  gh.listCandidateIssues.mockReturnValue([]);
  gh.postMarker.mockReturnValue(MARKER);
  mockRunRepoHygiene.mockReturnValue({ ...CLEAN_HYGIENE });
  mockPrepareBaseBranch.mockReturnValue({ ok: true, branch: "develop" });
  mockPreparePrBranch.mockReturnValue({ ok: true, branch: "feature/042" });
  mockGetCurrentBranchPr.mockReturnValue(null);
  // A discussion turn that created a branch is the normal case for link repair.
  mockGetCurrentBranch.mockReturnValue("feature/042-flag");
  gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));
  mockInvokeClaude.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

/* ── preconditions ──────────────────────────────────────────────────────── */

describe("do-work preconditions", () => {
  it("refuses an Azure DevOps remote and points at the gap document", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, remoteType: "azdo" });
    await runDoWork();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/only supported for GitHub/);
    expect(stderr).toMatch(/docs\/azdo-gap\.md/);
  });

  it("refuses a missing discovery technique", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, issueDiscoveryTechnique: undefined });
    await runDoWork();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/issue-discovery-technique/);
  });

  it("refuses a missing discovery value", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, issueDiscoveryValue: undefined });
    await runDoWork();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/issue-discovery-value/);
  });

  it("refuses an empty allowed-users list", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, allowedUsers: ["  "] });
    await runDoWork();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/config set allowed-users/);
  });

  it("refuses a missing agent user", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, agentUser: "" });
    await runDoWork();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/config set agent-user/);
  });

  it("refuses an unresolvable prompt instead of falling back to the default", async () => {
    mockReadConfig.mockImplementation(() => {
      throw new Error('Prompt file "missing.md" not found in ".automata"');
    });
    await runDoWork();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/missing\.md/);
    expect(mockAcquireRunLock).not.toHaveBeenCalled();
  });

  it("rejects an unknown executor", async () => {
    await runDoWork(["--with", "gemini"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--with must be 'claude' or 'codex'/);
  });

  it("refuses when gh is authenticated as an account that may instruct the agent", async () => {
    // The marker would be attributed to an authorized account, so each tick would
    // answer the marker left by the previous tick, forever.
    gh.getAuthenticatedLogin.mockReturnValue("alice");
    await runDoWork();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/authenticated as "alice", which is listed in allowedUsers/);
    expect(stderr).toMatch(/answer the previous tick forever/);
    expect(gh.listCandidateIssues).not.toHaveBeenCalled();
  });

  it("refuses regardless of login casing", async () => {
    gh.getAuthenticatedLogin.mockReturnValue("ALICE");
    await runDoWork();
    expect(exitCode).toBe(1);
  });

  it("refuses a known login mismatch even when the login is not authorized", async () => {
    // The marker would be posted by an account that is neither the agent nor
    // authorized, so the conversation filter drops it: the boundary never
    // advances and the same message starts a run on every tick.
    gh.getAuthenticatedLogin.mockReturnValue("some-other-bot");
    await runDoWork();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/authenticated as "some-other-bot" but agentUser is "automata-bot"/);
    expect(stderr).toMatch(/boundary would never advance/);
    expect(gh.listCandidateIssues).not.toHaveBeenCalled();
  });

  it("proceeds silently when the login is the agent, matched case-insensitively", async () => {
    gh.getAuthenticatedLogin.mockReturnValue("AUTOMATA-BOT");
    await runDoWork();
    expect(exitCode).toBeUndefined();
    expect(stderr).not.toMatch(/Warning/);
  });

  it("warns but proceeds when the login cannot be determined, as with an app token", async () => {
    gh.getAuthenticatedLogin.mockReturnValue(null);
    await runDoWork();
    expect(exitCode).toBeUndefined();
    expect(stderr).toMatch(/could not determine which account/);
  });

  it.each([
    ["an unrecognised executor", { executor: "gemini" }, /doWork.executor must be 'claude' or 'codex'/],
    ["a negative run cap", { maxRunsPerTick: -1 }, /maxRunsPerTick must be a non-negative integer/],
    ["a fractional run cap", { maxRunsPerTick: 1.5 }, /maxRunsPerTick must be a non-negative integer/],
    ["a zero lock window", { lockStaleMinutes: 0 }, /lockStaleMinutes must be a positive integer/],
    ["an empty base branch", { baseBranch: "  " }, /baseBranch must be a non-empty string/],
    ["a non-string base branch", { baseBranch: 7 }, /baseBranch must be a non-empty string/],
    ["an empty model", { models: { claude: "" } }, /models.claude must be a non-empty string/],
    // Hand-edited JSON need not match the declared shape at all.
    ["a non-object doWork section", "nope", /doWork must be an object/],
    ["a string where prompts should be an object", { prompts: "custom.md" }, /doWork.prompts must be an object/],
    ["an unrecognised prompt key", { prompts: { discuss: "x.md" } }, /doWork.prompts.discuss is not a recognised setting/],
    ["a non-object models section", { models: [] }, /doWork.models must be an object/],
    ["an empty effort", { effort: { claude: "" } }, /effort.claude must be a non-empty string/],
    ["a non-object effort section", { effort: [] }, /doWork.effort must be an object/],
    ["an unrecognised effort key", { effort: { gemini: "high" } }, /doWork.effort.gemini is not a recognised setting/],
  ])("refuses %s in the doWork section", async (_what, doWork, expected) => {
    // The types say these are well formed; the hand-edited file makes no such
    // promise, and an unattended loop is the worst place to misread it silently.
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork });
    await runDoWork();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(expected);
    expect(mockAcquireRunLock).not.toHaveBeenCalled();
  });

  it.each([
    ["--issue", ["--issue", "42junk"]],
    ["--limit", ["--limit", "3.5"]],
    ["--max-runs", ["--max-runs", "2abc"]],
  ])("rejects a malformed %s value rather than parsing a prefix", async (_what, args) => {
    await runDoWork(args);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/must be a positive integer/);
  });

  it("allows --dry-run from a workstation, since it posts nothing", async () => {
    // The guard exists to protect what gets posted; a dry run posts nothing, and
    // blocking it would break the primary diagnostic.
    gh.getAuthenticatedLogin.mockReturnValue("alice");
    await runDoWork(["--dry-run"]);
    expect(exitCode).toBeUndefined();
    expect(stdout).toMatch(/candidates need an answer/);
    expect(gh.postMarker).not.toHaveBeenCalled();
  });

  it("does no GitHub work when any precondition fails", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, agentUser: "" });
    await runDoWork();
    expect(gh.listCandidateIssues).not.toHaveBeenCalled();
    expect(gh.postMarker).not.toHaveBeenCalled();
  });
});

/* ── locking ────────────────────────────────────────────────────────────── */

describe("do-work locking", () => {
  it("does nothing and exits 0 when another instance holds the lock", async () => {
    mockAcquireRunLock.mockReturnValue({
      ok: false,
      heldBy: { pid: 4242, startedAt: "2026-01-10T00:00:00Z", host: "runner-1", command: "do-work" },
    });
    await runDoWork();
    expect(exitCode).toBeUndefined();
    expect(stdout).toMatch(/Another automata instance is already running/);
    expect(stdout).toMatch(/pid 4242/);
    // Nothing state-changing may happen while another instance is working.
    expect(gh.listCandidateIssues).not.toHaveBeenCalled();
    expect(gh.getOpenPrLinkMap).not.toHaveBeenCalled();
    expect(gh.assignIssueToAgent).not.toHaveBeenCalled();
    expect(gh.postMarker).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it("takes the lock before any GitHub call", async () => {
    const order: string[] = [];
    mockAcquireRunLock.mockImplementation(() => {
      order.push("lock");
      return { ok: true, handle: { release: mockRelease } };
    });
    gh.listCandidateIssues.mockImplementation(() => {
      order.push("list");
      return [];
    });
    await runDoWork();
    expect(order).toEqual(["lock", "list"]);
  });

  it("releases the lock when the tick completes", async () => {
    await runDoWork();
    expect(mockRelease).toHaveBeenCalled();
  });

  it("keeps stdout parseable when the lock is held and --json was asked for", async () => {
    mockAcquireRunLock.mockReturnValue({
      ok: false,
      heldBy: { pid: 4242, startedAt: "2026-01-10T00:00:00Z", host: "runner-1", command: "do-work", token: "t" },
    });
    await runDoWork(["--json"]);
    const payload = JSON.parse(stdout) as { lockHeld: boolean; exitCode: number };
    expect(payload.lockHeld).toBe(true);
    expect(payload.exitCode).toBe(0);
    expect(stderr).toMatch(/Another automata instance is already running/);
  });

  it("reports a refresh failure as a failed item rather than aborting the tick", async () => {
    // Exit 1 is documented as "nothing was attempted", so a mid-tick read error
    // must not take that path and discard the summary for work already done.
    gh.listCandidateIssues.mockReturnValue([issue(42), issue(43)]);
    let reads = 0;
    gh.getIssueSurface.mockImplementation((n: number) => {
      reads++;
      if (n === 42 && reads > 2) throw new Error("gh rate limited");
      return needsWork(n);
    });
    await runDoWork();
    expect(exitCode).toBe(2);
    expect(stdout).toMatch(/#42 issue-discuss failed — gh rate limited/);
    expect(stdout).toMatch(/#43 issue-discuss/);
  });

  it("releases the lock when the tick throws", async () => {
    gh.listCandidateIssues.mockImplementation(() => {
      throw new Error("gh exploded");
    });
    await runDoWork();
    expect(mockRelease).toHaveBeenCalled();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/gh exploded/);
  });
});

/* ── nothing to do ──────────────────────────────────────────────────────── */

describe("do-work with nothing to do", () => {
  it("exits 0, posts nothing and spawns nothing when no issue matches", async () => {
    await runDoWork();
    expect(exitCode).toBeUndefined();
    expect(stdout).toMatch(/0 of 0 candidates need an answer/);
    expect(gh.postMarker).not.toHaveBeenCalled();
    expect(gh.assignIssueToAgent).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it("exits 0 when the agent already answered every issue", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockReturnValue(settled(42));
    await runDoWork();
    expect(exitCode).toBeUndefined();
    expect(stdout).toMatch(/nothing to do/);
    expect(gh.postMarker).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });
});

/* ── the discuss turn ───────────────────────────────────────────────────── */

describe("do-work discuss turn", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockReturnValue(needsWork(42));
  });

  it("prepares the base branch, assigns, marks, then invokes the executor in that order", async () => {
    const order: string[] = [];
    mockPrepareBaseBranch.mockImplementation(() => {
      order.push("prepare");
      return { ok: true, branch: "develop" };
    });
    gh.assignIssueToAgent.mockImplementation(() => order.push("assign"));
    gh.postMarker.mockImplementation(() => {
      order.push("marker");
      return MARKER;
    });
    mockInvokeClaude.mockImplementation(() => {
      order.push("model");
      return Promise.resolve();
    });
    await runDoWork();
    expect(order).toEqual(["prepare", "assign", "marker", "model"]);
  });

  it("passes the composed prompt with the default frame and the context", async () => {
    await runDoWork();
    const prompt = mockInvokeClaude.mock.calls[0][0] as string;
    expect(prompt).toMatch(/Do not modify, create or delete any file/);
    expect(prompt).toContain("Turn: issue-discuss");
    expect(prompt).toContain("Issue #42");
    expect(prompt).toContain("Repository: acme/widget");
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ printSteps: true });
  });

  it("skips assignment when the agent is already assigned", async () => {
    gh.getIssueSurface.mockReturnValue(needsWork(42, ["automata-bot"]));
    await runDoWork();
    expect(gh.assignIssueToAgent).not.toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalled();
  });

  it("leaves an issue a human already owns alone rather than adding the agent beside them", async () => {
    gh.getIssueSurface.mockReturnValue(needsWork(42, ["alice"]));
    await runDoWork();
    expect(gh.assignIssueToAgent).not.toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalled();
  });

  it("claims the pull request the model opened during the turn", async () => {
    mockGetCurrentBranchPr.mockReturnValue({ number: 57, url: "https://gh/pr/57", body: "body", assignees: [] });
    await runDoWork();
    expect(gh.assignPrToAgent).toHaveBeenCalledWith(57, "automata-bot");
  });

  it("leaves a pull request somebody has already taken alone", async () => {
    mockGetCurrentBranchPr.mockReturnValue({ number: 57, url: "https://gh/pr/57", body: "body", assignees: ["alice"] });
    await runDoWork();
    expect(gh.assignPrToAgent).not.toHaveBeenCalled();
  });

  it("still links the pull request when claiming it fails", async () => {
    mockGetCurrentBranchPr.mockReturnValue({ number: 57, url: "https://gh/pr/57", body: "body", assignees: [] });
    gh.assignPrToAgent.mockImplementation(() => {
      throw new Error("HTTP 403: not a collaborator");
    });
    await runDoWork();
    expect(stderr).toMatch(/could not assign pull request #57/);
    expect(mockAddClosesRefToPr).toHaveBeenCalledWith(57, 42);
  });

  it("warns but still runs the turn when assignment fails", async () => {
    gh.assignIssueToAgent.mockImplementation(() => {
      throw new Error("HTTP 403: not a collaborator");
    });
    await runDoWork();
    expect(stderr).toMatch(/could not assign issue #42/);
    expect(mockInvokeClaude).toHaveBeenCalled();
  });

  it("skips the item without invoking the model when the marker cannot be posted", async () => {
    gh.postMarker.mockImplementation(() => {
      throw new Error("HTTP 403");
    });
    await runDoWork();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
    expect(stdout).toMatch(/skipped/);
  });

  it("skips the item on a dirty working tree without touching GitHub state", async () => {
    mockPrepareBaseBranch.mockReturnValue({ ok: false, reason: "dirty-tree", detail: "uncommitted changes" });
    await runDoWork();
    expect(gh.assignIssueToAgent).not.toHaveBeenCalled();
    expect(gh.postMarker).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
    expect(stdout).toMatch(/dirty-tree/);
  });
});

/* ── marker reconciliation ──────────────────────────────────────────────── */

describe("do-work marker reconciliation", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
  });

  it("deletes the marker when the agent posted an answer", async () => {
    answersAfterMarker();
    await runDoWork();
    expect(gh.deleteMarker).toHaveBeenCalledWith(MARKER);
    expect(gh.updateMarker).not.toHaveBeenCalled();
    expect(exitCode).toBeUndefined();
    expect(stdout).toMatch(/answered/);
  });

  it("updates the marker in place and never deletes it when no answer was posted", async () => {
    gh.getIssueSurface.mockReturnValue(needsWork(42));
    await runDoWork();
    expect(gh.deleteMarker).not.toHaveBeenCalled();
    expect(gh.updateMarker).toHaveBeenCalledTimes(1);
    const body = gh.updateMarker.mock.calls[0][1] as string;
    expect(body).toMatch(/finished without posting an answer/);
    expect(body).toMatch(/Reply on issue #42/);
    // Must not claim nothing changed: the run can push and still fail to comment.
    expect(body).not.toMatch(/Nothing was changed/);
    // A discuss turn sits on the base branch, so naming it would be misleading;
    // what it may have done is branch and open a pull request.
    expect(body).toMatch(/may still have created a branch or opened a pull request/);
    expect(body).not.toMatch(/changed the branch `develop`/);
    expect(exitCode).toBe(2);
    expect(stdout).toMatch(/answered-no-reply/);
  });

  it("reconciles after a failed run and reports the failure in the marker", async () => {
    gh.getIssueSurface.mockReturnValue(needsWork(42));
    mockInvokeClaude.mockRejectedValue(new Error("claude exited with code 1"));
    await runDoWork();
    expect(gh.updateMarker).toHaveBeenCalledTimes(1);
    expect(gh.updateMarker.mock.calls[0][1]).toMatch(/failed before posting an answer/);
    expect(exitCode).toBe(2);
    expect(stdout).toMatch(/failed/);
  });

  it("deletes the marker for a non-zero run that still posted an answer", async () => {
    answersAfterMarker();
    mockInvokeClaude.mockRejectedValue(new Error("claude exited with code 1"));
    await runDoWork();
    expect(gh.deleteMarker).toHaveBeenCalled();
    expect(stdout).toMatch(/answered, but the run reported/);
    expect(exitCode).toBeUndefined();
  });

  it("keeps the marker and says the answer is unverified when the re-read fails", async () => {
    // Unknown is not the same as "no answer": asserting the latter would tell
    // humans something the code has not established.
    gh.getIssueSurface.mockImplementation((n: number) => {
      if (gh.postMarker.mock.calls.length > 0) throw new Error("gh rate limited");
      return needsWork(n);
    });
    await runDoWork();
    expect(gh.deleteMarker).not.toHaveBeenCalled();
    expect(stderr).toMatch(/could not re-read issue #42/);
    expect(gh.updateMarker.mock.calls[0][1]).toMatch(/could not read issue #42 afterwards/);
    expect(gh.updateMarker.mock.calls[0][1]).not.toMatch(/without posting an answer/);
  });

  it("warns but still reports the item as answered when the delete fails", async () => {
    answersAfterMarker();
    gh.deleteMarker.mockImplementation(() => {
      throw new Error("HTTP 403");
    });
    await runDoWork();
    expect(stderr).toMatch(/could not delete the marker comment/);
    expect(exitCode).toBeUndefined();
    expect(stdout).toMatch(/answered/);
  });

  it("warns loudly when the marker update fails, because nobody has been told", async () => {
    gh.getIssueSurface.mockReturnValue(needsWork(42));
    gh.updateMarker.mockImplementation(() => {
      throw new Error("HTTP 403");
    });
    await runDoWork();
    expect(stderr).toMatch(/could not update the marker comment on issue #42/);
    expect(stderr).toMatch(/have not been told/);
    expect(exitCode).toBe(2);
  });

  it("flags an authorized message that arrived while the run was in progress", async () => {
    // A stateless boundary cannot carry it forward: the agent's answer is newer,
    // so the next tick will not see it as new. Saying so is the only honest
    // option — the alternative is losing it silently.
    gh.getIssueSurface.mockImplementation(() =>
      gh.postMarker.mock.calls.length > 0
        ? {
            ...needsWork(42),
            messages: [
              message("alice", "2026-01-01T00:00:00Z", "issue-body"),
              message("alice", "2026-01-10T00:03:00Z"),
              message("automata-bot", "2026-01-10T00:08:00Z"),
            ],
          }
        : needsWork(42),
    );
    await runDoWork();
    const notes = gh.postMarker.mock.calls.filter((call) => String(call[2]).includes("while this run"));
    expect(notes).toHaveLength(1);
    expect(notes[0][2]).toMatch(/alice posted here while this run was already in progress/);
    expect(notes[0][2]).toMatch(/Please post again/);
    // The answer still counted, so the marker is gone, but the tick is degraded.
    expect(gh.deleteMarker).toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

  it("does not flag anything when no message arrived mid-run", async () => {
    answersAfterMarker();
    await runDoWork();
    expect(gh.postMarker.mock.calls.filter((call) => String(call[2]).includes("while this run"))).toHaveLength(0);
    expect(exitCode).toBeUndefined();
  });

  it("counts a reply inside a review thread as an answer on a build turn", async () => {
    gh.getIssueSurface.mockReturnValue(settled(42));
    gh.getOpenPrLinkMap.mockReturnValue({ byIssue: new Map([[42, [PR]]]), defaultBranch: "main", orphans: [] });
    gh.getPrSurface.mockImplementation(() =>
      gh.postMarker.mock.calls.length > 0
        ? prSurface({
            threads: [
              {
                path: "src/index.ts",
                line: 1,
                isResolved: false,
                url: null,
                comments: [message("automata-bot", "2026-01-10T00:05:00Z", "thread-comment")],
              },
            ],
          })
        : prSurface({ messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")] }),
    );
    await runDoWork();
    expect(gh.deleteMarker).toHaveBeenCalled();
    expect(exitCode).toBeUndefined();
  });
});

/* ── the build turn ─────────────────────────────────────────────────────── */

describe("do-work build turn", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockReturnValue(settled(42));
    gh.getOpenPrLinkMap.mockReturnValue({ byIssue: new Map([[42, [PR]]]), defaultBranch: "main", orphans: [] });
    gh.getPrSurface.mockReturnValue(
      prSurface({ messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")] }),
    );
  });

  it("checks out the pull request branch and marks the pull request, not the issue", async () => {
    await runDoWork();
    expect(mockPreparePrBranch).toHaveBeenCalledWith("feature/042");
    expect(mockPrepareBaseBranch).not.toHaveBeenCalled();
    expect(gh.postMarker).toHaveBeenCalledWith("pr", 57, expect.stringContaining("working"));
  });

  it("claims the pull request it is working on when nobody is assigned to it", async () => {
    await runDoWork();
    expect(gh.assignPrToAgent).toHaveBeenCalledWith(57, "automata-bot");
  });

  it("leaves the pull request alone when anyone is already assigned to it", async () => {
    gh.getPrSurface.mockReturnValue(
      prSurface({
        assignees: ["alice"],
        messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")],
      }),
    );
    await runDoWork();
    expect(gh.assignPrToAgent).not.toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalled();
  });

  it("warns but still runs the turn when the pull request claim fails", async () => {
    gh.assignPrToAgent.mockImplementation(() => {
      throw new Error("HTTP 403: not a collaborator");
    });
    await runDoWork();
    expect(stderr).toMatch(/could not assign pull request #57/);
    expect(mockInvokeClaude).toHaveBeenCalled();
    // The failed claim is not what the item is reported on: the outcome still
    // comes from whether the model answered.
    expect(stdout).not.toMatch(/assign.*failed/);
  });

  it("uses the build frame and names the branch", async () => {
    await runDoWork();
    const prompt = mockInvokeClaude.mock.calls[0][0] as string;
    expect(prompt).toMatch(/Do not merge the pull request/);
    expect(prompt).toContain("Turn: pr-work");
    expect(prompt).toContain("Branch: feature/042");
  });

  it("notes the pickup on the issue when issue messages triggered the build turn", async () => {
    // The surfaces keep independent boundaries. Answering only on the pull
    // request would leave the issue comment new forever, starting another build
    // turn on every tick.
    gh.getIssueSurface.mockReturnValue(needsWork(42, ["automata-bot"]));
    await runDoWork();
    const issueNotes = gh.postMarker.mock.calls.filter((call) => call[0] === "issue");
    expect(issueNotes).toHaveLength(1);
    expect(issueNotes[0][2]).toMatch(/picked this up on pull request #57/);
    // The transient working marker still goes on the pull request.
    expect(gh.postMarker.mock.calls.some((call) => call[0] === "pr")).toBe(true);
  });

  it("does not note a pickup when only the pull request had new messages", async () => {
    await runDoWork();
    expect(gh.postMarker.mock.calls.filter((call) => call[0] === "issue")).toHaveLength(0);
  });

  it("keeps the permanent issue note, deleting only the pull request marker", async () => {
    gh.getIssueSurface.mockImplementation(() =>
      gh.postMarker.mock.calls.length > 0 ? settled(42) : needsWork(42, ["automata-bot"]),
    );
    gh.getPrSurface.mockImplementation(() =>
      gh.postMarker.mock.calls.length > 1
        ? prSurface({ messages: [message("automata-bot", "2026-01-10T00:05:00Z", "pr-comment")] })
        : prSurface({ messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")] }),
    );
    await runDoWork();
    expect(gh.deleteMarker).toHaveBeenCalledTimes(1);
  });

  it("skips rather than looping when the issue pickup note cannot be posted", async () => {
    gh.getIssueSurface.mockReturnValue(needsWork(42, ["automata-bot"]));
    gh.postMarker.mockImplementation((surface: string) => {
      if (surface === "issue") throw new Error("HTTP 403");
      return MARKER;
    });
    await runDoWork();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
    expect(stdout).toMatch(/issue pickup note failed/);
  });

  it("withdraws the working marker when the issue note fails, so neither boundary moves", async () => {
    // The note is permanent. Posting it and then failing to post the marker
    // would advance the issue boundary past a message that was never answered —
    // buried, with nothing on GitHub saying so. So the marker goes first and is
    // withdrawn if the note cannot follow it.
    gh.getIssueSurface.mockReturnValue(needsWork(42, ["automata-bot"]));
    const order: string[] = [];
    gh.postMarker.mockImplementation((surface: string) => {
      order.push(surface);
      if (surface === "issue") throw new Error("HTTP 403");
      return MARKER;
    });
    await runDoWork();
    expect(order).toEqual(["pr", "issue"]);
    expect(gh.deleteMarker).toHaveBeenCalledWith(MARKER);
  });

  it("does not attempt link repair on a build turn", async () => {
    await runDoWork();
    expect(mockGetCurrentBranchPr).not.toHaveBeenCalled();
    expect(mockAddClosesRefToPr).not.toHaveBeenCalled();
  });

  it("skips the item when the pull request branch cannot be prepared", async () => {
    mockPreparePrBranch.mockReturnValue({ ok: false, reason: "pull-failed", detail: "diverged" });
    await runDoWork();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });
});

/* ── link repair ────────────────────────────────────────────────────────── */

describe("do-work link repair", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockReturnValue(needsWork(42));
  });

  it("adds the closing reference when the model opened an unlinked pull request", async () => {
    mockGetCurrentBranchPr.mockReturnValue({ number: 57, url: "https://gh/pr/57", body: "some body", assignees: [] });
    await runDoWork();
    expect(mockAddClosesRefToPr).toHaveBeenCalledWith(57, 42);
  });

  it("leaves the body untouched when the reference is already present", async () => {
    mockGetCurrentBranchPr.mockReturnValue({ number: 57, url: "https://gh/pr/57", body: "Closes #42", assignees: [] });
    await runDoWork();
    expect(mockAddClosesRefToPr).not.toHaveBeenCalled();
    expect(stderr).toMatch(/already closes issue #42/);
  });

  it("reports the issue as still in discussion when no pull request exists", async () => {
    await runDoWork();
    expect(mockAddClosesRefToPr).not.toHaveBeenCalled();
    expect(stderr).toMatch(/still in discussion/);
  });

  it("never touches the base branch's own pull request when the model only replied", async () => {
    // Still on the base branch after the turn, where getCurrentBranchPr() would
    // return develop's own PR — a release PR into main, say. Appending
    // `Closes #42` to that would make an unrelated merge close this issue.
    mockGetCurrentBranch.mockReturnValue("develop");
    mockGetCurrentBranchPr.mockReturnValue({ number: 99, url: "https://gh/pr/99", body: "release", assignees: [] });
    await runDoWork();
    expect(mockGetCurrentBranchPr).not.toHaveBeenCalled();
    expect(mockAddClosesRefToPr).not.toHaveBeenCalled();
    expect(stderr).toMatch(/no branch was created/);
  });

  it("warns rather than failing when the link cannot be repaired", async () => {
    mockGetCurrentBranchPr.mockReturnValue({ number: 57, url: "u", body: "", assignees: [] });
    mockAddClosesRefToPr.mockImplementation(() => {
      throw new Error("HTTP 403");
    });
    await runDoWork();
    expect(stderr).toMatch(/could not link a pull request/);
  });
});

/* ── the queue ──────────────────────────────────────────────────────────── */

describe("do-work queue handling", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([issue(42), issue(43), issue(44)]);
    gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));
  });

  it("processes every item sequentially in plan order", async () => {
    const seen: number[] = [];
    gh.postMarker.mockImplementation((_surface: string, number: number) => {
      seen.push(number);
      return MARKER;
    });
    await runDoWork();
    expect(seen).toEqual([42, 43, 44]);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(3);
  });

  it("re-reads each item just before running it, so a message arriving mid-tick is answered", async () => {
    // The plan is built before any model runs, and an earlier item can take
    // hours. A comment arriving in that window used to be omitted from the
    // prompt and then buried behind the marker, so it was never new again.
    const late = message("alice", "2026-01-09T00:00:00Z");
    let firstItemDone = false;
    mockInvokeClaude.mockImplementation(() => {
      firstItemDone = true;
      return Promise.resolve();
    });
    gh.getIssueSurface.mockImplementation((n: number) => {
      const surface = needsWork(n);
      // Alice comments on #44 while #42 is being worked.
      if (n === 44 && firstItemDone) {
        return { ...surface, messages: [...surface.messages, late] };
      }
      return surface;
    });

    await runDoWork();

    const promptFor44 = mockInvokeClaude.mock.calls
      .map((call) => call[0] as string)
      .find((prompt) => prompt.includes("Issue #44"));
    expect(promptFor44).toBeDefined();
    expect(promptFor44).toContain(late.body);
  });

  it("skips an item that stopped being actionable while an earlier one ran", async () => {
    let firstItemDone = false;
    mockInvokeClaude.mockImplementation(() => {
      firstItemDone = true;
      return Promise.resolve();
    });
    gh.getIssueSurface.mockImplementation((n: number) =>
      n === 44 && firstItemDone ? { ...needsWork(n), state: "CLOSED" as const } : needsWork(n),
    );

    await runDoWork();

    expect(stdout).toMatch(/#44 issue-discuss skipped — no longer actionable/);
    const prompts = mockInvokeClaude.mock.calls.map((call) => call[0] as string);
    expect(prompts.some((prompt) => prompt.includes("Issue #44"))).toBe(false);
    expect(exitCode).toBe(2);
  });

  it("keeps going after a failed run and exits 2", async () => {
    mockInvokeClaude
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    await runDoWork();
    expect(mockInvokeClaude).toHaveBeenCalledTimes(3);
    expect(exitCode).toBe(2);
    expect(stdout).toMatch(/#43 issue-discuss failed/);
    expect(stdout).toMatch(/#44 issue-discuss/);
  });

  it("counts model runs against the cap, not planned items", async () => {
    // A skipped item must not consume a slot: a tick configured for one run
    // could otherwise perform none while actionable work waits.
    mockPrepareBaseBranch
      .mockReturnValueOnce({ ok: false, reason: "dirty-tree", detail: "uncommitted changes" })
      .mockReturnValue({ ok: true, branch: "develop" });

    await runDoWork(["--max-runs", "1"]);

    // #42 was skipped without running a model, so #43 still got its run.
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
    const prompt = mockInvokeClaude.mock.calls[0][0] as string;
    expect(prompt).toContain("Issue #43");
    expect(stdout).toMatch(/#44 issue-discuss deferred/);
  });

  it("re-resolves the issue-to-pull-request link on refresh, not just the conversation", async () => {
    // A pull request opened for this issue while an earlier item ran must switch
    // the turn to pr-work; the plan-time link map would still say there is none
    // and we would start a competing implementation on the base branch.
    gh.listCandidateIssues.mockReturnValue([issue(42), issue(43)]);
    gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));
    let mapReads = 0;
    gh.getOpenPrLinkMap.mockImplementation(() => {
      mapReads++;
      // Empty for the plan and #42's refresh; #43 gains a linked PR afterwards.
      return { byIssue: mapReads >= 3 ? new Map([[43, [PR]]]) : new Map(), defaultBranch: "main", orphans: [] };
    });
    gh.getPrSurface.mockReturnValue(
      prSurface({ messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")] }),
    );

    await runDoWork();

    // #43 was planned as a discussion turn and ran as a build turn.
    expect(mockPreparePrBranch).toHaveBeenCalledWith("feature/042");
    expect(stderr).toMatch(/turn changed to pr-work/);
    expect(stdout).toMatch(/#43 pr-work/);
  });

  it("reports the refreshed turn, not the one the stale plan predicted", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockReturnValue(needsWork(42));
    let mapReads = 0;
    gh.getOpenPrLinkMap.mockImplementation(() => {
      mapReads++;
      // Planned as pr-work; the pull request is merged by the time it runs, so
      // the turn becomes a discussion — and the report must say so.
      return {
        byIssue:
          mapReads === 1
            ? new Map([[42, [PR]]])
            : new Map([[42, [{ ...PR, state: "MERGED" as const }]]]),
        defaultBranch: "main",
        orphans: [],
      };
    });
    gh.getPrSurface.mockReturnValue(
      prSurface({ messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")] }),
    );

    await runDoWork(["--json"]);

    const payload = JSON.parse(stdout) as { items: { turn: string }[] };
    expect(payload.items[0].turn).toBe("issue-discuss");
  });

  it("defers the remainder when --max-runs is reached", async () => {
    await runDoWork(["--max-runs", "2"]);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(2);
    expect(exitCode).toBe(2);
    expect(stdout).toMatch(/#44 issue-discuss deferred/);
  });

  it("honours the configured per-tick cap", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { maxRunsPerTick: 1 } });
    await runDoWork();
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
  });

  it("restricts the tick to one issue with --issue", async () => {
    await runDoWork(["--issue", "43"]);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
    const prompt = mockInvokeClaude.mock.calls[0][0] as string;
    expect(prompt).toContain("Issue #43");
  });

  it("reports when --issue does not match the discovery filter", async () => {
    // Checked against the issue itself, not against the candidate page: an issue
    // beyond --limit would otherwise be reported as non-matching.
    gh.getIssueSurface.mockImplementation((n: number) => ({ ...needsWork(n), labels: ["bug"] }));
    await runDoWork(["--issue", "99"]);
    expect(stderr).toMatch(/does not match the configured discovery filter/);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
  });

  it("does not report a filter mismatch for an issue that matches but is beyond --limit", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42), issue(43), issue(44)]);
    gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));
    await runDoWork(["--issue", "99"]);
    expect(stderr).not.toMatch(/does not match the configured discovery filter/);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
  });

  it("notes when the issue list was truncated by the limit", async () => {
    await runDoWork(["--limit", "3"]);
    expect(stderr).toMatch(/fetched the maximum of 3 issues/);
  });
});

/* ── output modes ───────────────────────────────────────────────────────── */

describe("do-work output modes", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockReturnValue(needsWork(42));
  });

  it("--dry-run prints the plan and changes nothing at all", async () => {
    await runDoWork(["--dry-run"]);
    expect(stdout).toMatch(/1 of 1 candidates need an answer/);
    expect(stdout).toMatch(/#42 issue-discuss on develop/);
    expect(stdout).toMatch(/will assign the issue to the agent/);
    expect(gh.assignIssueToAgent).not.toHaveBeenCalled();
    expect(gh.postMarker).not.toHaveBeenCalled();
    expect(gh.updateMarker).not.toHaveBeenCalled();
    expect(gh.deleteMarker).not.toHaveBeenCalled();
    expect(mockPrepareBaseBranch).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(mockAddClosesRefToPr).not.toHaveBeenCalled();
    expect(exitCode).toBeUndefined();
  });

  it("--dry-run prints a summary header and the command per item", async () => {
    await runDoWork(["--dry-run"]);
    expect(stdout).toContain("Issue #42 — Issue 42");
    expect(stdout).toContain("Turn         issue-discuss");
    expect(stdout).toContain("Branch       develop (would check out and pull)");
    expect(stdout).toContain("would assign issue to automata-bot");
    expect(stdout).toContain("Marker       would post on issue #42");
    expect(stdout).toContain("Executor     claude");
    expect(stdout).toContain("Permissions  bypassed");
    expect(stdout).toContain("Command that would be launched:");
    expect(stdout).toContain("Dry run: nothing was rescued, pruned, pulled, assigned, posted, checked out or executed.");
  });

  it("--dry-run prints the same argv the real run would spawn", async () => {
    // The printed command comes from the shared argv builder; rebuilding it
    // separately would let the dry run drift from what actually happens.
    await runDoWork(["--dry-run", "--model", "claude-opus-4-6"]);
    expect(stdout).toContain("--dangerously-skip-permissions");
    expect(stdout).toContain("--model claude-opus-4-6");
    expect(stdout).toContain("--verbose --output-format stream-json");
    expect(stdout).toContain("-p ");
  });

  it("--dry-run keeps the streaming flags under --silent, because the run does too", async () => {
    // The child is always spawned asynchronously so a signal can stop it;
    // --silent suppresses printing, it does not change the argv.
    await runDoWork(["--dry-run", "--silent"]);
    expect(stdout).toContain("--dangerously-skip-permissions");
    expect(stdout).toContain("--output-format stream-json");
  });

  it("--dry-run shows the codex command when codex is selected", async () => {
    await runDoWork(["--dry-run", "--with", "codex", "--model", "o3"]);
    expect(stdout).toContain("Executor     codex · model o3");
    expect(stdout).toContain("exec --dangerously-bypass-approvals-and-sandbox --model o3");
  });

  it("--dry-run prints the effort argument as part of the claude command", async () => {
    await runDoWork(["--dry-run", "--effort", "high"]);
    expect(stdout).toContain("Executor     claude (no model override) · effort high");
    expect(stdout).toContain("--effort high");
  });

  it("--dry-run prints the codex effort as the -c override that would be spawned", async () => {
    // Codex has no effort flag, so the dry run must show the config override or
    // it would be describing a command codex could not run.
    await runDoWork(["--dry-run", "--with", "codex", "--effort", "high"]);
    expect(stdout).toContain("Executor     codex (no model override) · effort high");
    expect(stdout).toContain(String.raw`-c 'model_reasoning_effort="high"'`);
  });

  it("--dry-run prints no effort argument when none is in force", async () => {
    await runDoWork(["--dry-run"]);
    expect(stdout).not.toContain("--effort");
    expect(stdout).not.toContain("effort ");
  });

  it("--dry-run --json reports the resolved effort", async () => {
    await runDoWork(["--dry-run", "--json", "--effort", "high"]);
    const payload = JSON.parse(stdout) as { runs: Record<string, unknown>[] };
    expect(payload.runs[0]).toMatchObject({ effort: "high" });
  });

  it("--dry-run --json reports a null effort when none is in force", async () => {
    await runDoWork(["--dry-run", "--json"]);
    const payload = JSON.parse(stdout) as { runs: Record<string, unknown>[] };
    expect(payload.runs[0]).toMatchObject({ effort: null });
  });

  it("--dry-run shell-quotes the prompt so the command can be pasted", async () => {
    await runDoWork(["--dry-run"]);
    const command = stdout.slice(stdout.indexOf("-p "));
    expect(command).toMatch(/-p '/);
  });

  it("--dry-run injects no indentation into the multi-line prompt", async () => {
    // The command is printed unindented on purpose: indenting the continuation
    // lines of a multi-line quoted argument would add leading whitespace to the
    // prompt the command actually sends, making the printed command a lie.
    // (The prompt cannot appear byte-identical inside a quoted argument, because
    // shell quoting has to escape the apostrophes in it — so this checks the
    // property that matters: newlines are not followed by injected padding.)
    await runDoWork(["--dry-run"]);
    expect(stdout).toContain(
      "--- Context assembled by automata ---\nRepository: acme/widget\nYou are: automata-bot",
    );
  });

  it("--dry-run reports the branch differently for a build turn", async () => {
    gh.getIssueSurface.mockReturnValue(settled(42));
    gh.getOpenPrLinkMap.mockReturnValue({ byIssue: new Map([[42, [PR]]]), defaultBranch: "main", orphans: [] });
    gh.getPrSurface.mockReturnValue(
      prSurface({ messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")] }),
    );
    await runDoWork(["--dry-run"]);
    expect(stdout).toContain("Branch       feature/042 (would check out and fast-forward)");
    expect(stdout).toContain("Marker       would post on pull request #57");
  });

  it("--dry-run names both planned claims on a build turn", async () => {
    gh.getIssueSurface.mockReturnValue(settled(42));
    gh.getOpenPrLinkMap.mockReturnValue({ byIssue: new Map([[42, [PR]]]), defaultBranch: "main", orphans: [] });
    gh.getPrSurface.mockReturnValue(
      prSurface({ messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")] }),
    );
    await runDoWork(["--dry-run"]);
    // `settled` is assigned to the agent already, so only the pull request is claimed.
    expect(stdout).toContain(
      "Assign       issue already assigned · would assign pull request #57 to automata-bot",
    );
    expect(stdout).toMatch(/will assign the pull request to the agent/);
    expect(gh.assignPrToAgent).not.toHaveBeenCalled();
  });

  it("--dry-run reports a pull request nobody would touch", async () => {
    gh.getIssueSurface.mockReturnValue(settled(42));
    gh.getOpenPrLinkMap.mockReturnValue({ byIssue: new Map([[42, [PR]]]), defaultBranch: "main", orphans: [] });
    gh.getPrSurface.mockReturnValue(
      prSurface({
        assignees: ["alice"],
        messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")],
      }),
    );
    await runDoWork(["--dry-run"]);
    expect(stdout).toContain(
      "Assign       issue already assigned · pull request #57 already assigned",
    );
  });

  it("--dry-run still changes nothing while printing the command", async () => {
    await runDoWork(["--dry-run"]);
    expect(gh.assignIssueToAgent).not.toHaveBeenCalled();
    expect(gh.assignPrToAgent).not.toHaveBeenCalled();
    expect(gh.postMarker).not.toHaveBeenCalled();
    expect(mockPrepareBaseBranch).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it("--dry-run takes no lock, so it neither creates the file nor is blocked by one", async () => {
    // It changes nothing, and being unable to inspect the plan while a tick is
    // running would defeat the primary diagnostic.
    mockAcquireRunLock.mockReturnValue({
      ok: false,
      heldBy: { pid: 4242, startedAt: "x", host: "h", command: "do-work", token: "t" },
      suspect: false,
    });
    await runDoWork(["--dry-run"]);
    expect(mockAcquireRunLock).not.toHaveBeenCalled();
    expect(stdout).toMatch(/candidates need an answer/);
  });

  it("--dry-run honours the run cap and says how many were deferred", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42), issue(43), issue(44)]);
    gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));
    await runDoWork(["--dry-run", "--max-runs", "1"]);
    expect(stdout).toContain("Issue #42");
    expect(stdout).not.toContain("Issue #43 —");
    expect(stdout).toContain("2 further item(s) deferred by the run cap.");
  });

  it("--dry-run --json includes the argv, command and prompt", async () => {
    await runDoWork(["--dry-run", "--json"]);
    const payload = JSON.parse(stdout) as {
      runs: { issue: number; turn: string; executor: string; args: string[]; command: string; prompt: string }[];
    };
    expect(payload.runs).toHaveLength(1);
    const run = payload.runs[0];
    expect(run).toMatchObject({ issue: 42, turn: "issue-discuss", executor: "claude" });
    expect(run.args).toContain("--dangerously-skip-permissions");
    expect(run.args.at(-2)).toBe("-p");
    expect(run.args.at(-1)).toBe(run.prompt);
    expect(run.command).toContain("-p ");
  });

  it("--json emits the plan on stdout with progress on stderr", async () =>{
    await runDoWork(["--dry-run", "--json"]);
    const payload = JSON.parse(stdout) as { dryRun: boolean; plan: Record<string, unknown>[] };
    expect(payload.dryRun).toBe(true);
    expect(payload.plan).toEqual([
      {
        issue: 42,
        title: "Issue 42",
        turn: "issue-discuss",
        branch: "develop",
        pr: null,
        needsAssignment: true,
        prNeedsAssignment: false,
        reason: expect.stringContaining("new issue message"),
      },
    ]);
    expect(stderr).toMatch(/Work plan/);
  });

  it("--json reports per-item outcomes and the exit code", async () => {
    await runDoWork(["--json"]);
    const payload = JSON.parse(stdout) as { items: Record<string, unknown>[]; exitCode: number };
    expect(payload.items).toEqual([
      {
        issue: 42,
        pr: null,
        title: "Issue 42",
        turn: "issue-discuss",
        outcome: "answered-no-reply",
        detail: expect.any(String),
        ranExecutor: true,
        executor: "claude",
        model: null,
        effort: null,
        executorSource: "default",
        modelSource: "none",
        effortSource: "none",
      },
    ]);
    expect(payload.exitCode).toBe(2);
  });

  it("--json reports a skipped issue with its reason", async () => {
    gh.getIssueSurface.mockReturnValue(settled(42));
    await runDoWork(["--dry-run", "--json"]);
    const payload = JSON.parse(stdout) as { plan: Record<string, unknown>[] };
    expect(payload.plan[0]).toMatchObject({ turn: null, skipReason: "no-new-messages" });
  });
});

/* ── executor selection ─────────────────────────────────────────────────── */

describe("do-work executor selection", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockReturnValue(needsWork(42));
  });

  it("uses codex when asked on the command line", async () => {
    await runDoWork(["--with", "codex", "--model", "o3"]);
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), { model: "o3" });
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it("always bypasses permission prompts, since an unattended run cannot answer one", async () => {
    // `runClaude` hard-codes yolo; the dry-run command output is where that is
    // asserted end to end.
    await runDoWork(["--dry-run"]);
    expect(stdout).toContain("--dangerously-skip-permissions");
  });

  it("defaults to Claude when nothing is configured", async () => {
    await runDoWork();
    expect(mockInvokeClaude).toHaveBeenCalled();
    expect(mockInvokeCodex).not.toHaveBeenCalled();
  });

  it("uses the configured executor and that executor's configured model", async () => {
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      doWork: { executor: "codex", models: { claude: "claude-opus-4-6", codex: "o4-mini" } },
    });
    await runDoWork();
    // The Claude default must not leak into a Codex run.
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), { model: "o4-mini" });
  });

  it("picks the Claude default when the executor is Claude", async () => {
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      doWork: { models: { claude: "claude-opus-4-6", codex: "o4-mini" } },
    });
    await runDoWork();
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ model: "claude-opus-4-6" });
  });

  it("picks the Codex default when --with codex overrides a Claude-configured executor", async () => {
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      doWork: { executor: "claude", models: { claude: "claude-opus-4-6", codex: "o4-mini" } },
    });
    await runDoWork(["--with", "codex"]);
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), { model: "o4-mini" });
  });

  it("lets --model override the configured default for the executor in use", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { models: { claude: "claude-opus-4-6" } } });
    await runDoWork(["--model", "claude-sonnet-4-6"]);
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ model: "claude-sonnet-4-6" });
  });

  it("passes no model when neither a flag nor a default for that executor is set", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { models: { codex: "o4-mini" } } });
    await runDoWork();
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ model: undefined });
  });

  it("uses the configured effort for the executor in use", async () => {
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      doWork: { executor: "codex", effort: { claude: "high", codex: "medium" } },
    });
    await runDoWork();
    // The Claude default must not leak into a Codex run.
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), {
      model: undefined,
      effort: "medium",
    });
  });

  it("trims a configured effort so padding cannot reach the executor", async () => {
    // Config validation only rejects an empty level, so `" high "` is written
    // through as-is. Untrimmed it is an unknown level, which claude ignores
    // silently — the run would quietly use the default effort instead.
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { effort: { claude: "  high  " } } });
    await runDoWork();
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ effort: "high" });
  });

  it("passes no effort when only the other executor has one configured", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { effort: { codex: "medium" } } });
    await runDoWork();
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ effort: undefined });
  });

  it("lets --effort override the configured default for the executor in use", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { effort: { claude: "medium" } } });
    await runDoWork(["--effort", "high"]);
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ effort: "high" });
  });

  it("forwards --effort when nothing is configured", async () => {
    await runDoWork(["--effort", "xhigh"]);
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ effort: "xhigh" });
  });

  it("forwards a level automata does not know, because the valid set is the executor's", async () => {
    // Deliberately not allow-listed: the valid set is model-specific and moves
    // between executor releases.
    await runDoWork(["--with", "codex", "--effort", "ultra"]);
    expect(mockInvokeCodex.mock.calls[0][1]).toMatchObject({ effort: "ultra" });
  });

  it("refuses an empty --effort rather than emitting a flag with no level", async () => {
    await runDoWork(["--effort", "  "]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--effort must be a non-empty level/);
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it("lets the command line override the configured executor", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { executor: "codex" } });
    await runDoWork(["--with", "claude"]);
    expect(mockInvokeClaude).toHaveBeenCalled();
    expect(mockInvokeCodex).not.toHaveBeenCalled();
  });

  it("forwards --silent as printSteps:false to Claude", async () => {
    await runDoWork(["--silent"]);
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ printSteps: false });
  });

  it("uses the configured prompts instead of the defaults", async () => {
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      doWork: { prompts: { issueDiscuss: "Use the `my-repo-discuss` skill." } },
    });
    await runDoWork();
    const prompt = mockInvokeClaude.mock.calls[0][0] as string;
    expect(prompt.startsWith("Use the `my-repo-discuss` skill.")).toBe(true);
    expect(prompt).not.toMatch(/Do not modify, create or delete any file/);
  });
});

/* ── message directives ─────────────────────────────────────────────────── */

/** An issue whose newest authorized message carries `body`. */
function withDirective(number: number, body: string): IssueSurface {
  return {
    ...needsWork(number),
    messages: [
      { kind: "issue-body", author: "alice", body: "please", createdAt: "2026-01-01T00:00:00Z" },
      { kind: "issue-comment", author: "alice", body, createdAt: "2026-01-02T00:00:00Z" },
    ],
  };
}

describe("do-work message directives", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    mockInvokeCodex.mockResolvedValue(undefined);
  });

  it("runs with Codex when the newest message says tool:codex", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "please do it — tool:codex"));
    await runDoWork();
    expect(mockInvokeCodex).toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it("beats --with, which beats the configuration", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { executor: "codex" } });
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "TOOL:CLAUDE"));
    await runDoWork(["--with", "codex"]);
    expect(mockInvokeClaude).toHaveBeenCalled();
    expect(mockInvokeCodex).not.toHaveBeenCalled();
  });

  it("passes a model: directive to the executor", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "model:claude-opus-4-6"));
    await runDoWork();
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ model: "claude-opus-4-6" });
  });

  it("beats --model", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "model:from-message"));
    await runDoWork(["--model", "from-flag"]);
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ model: "from-message" });
  });

  it("uses the new executor's configured model when tool: switches executor", async () => {
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      doWork: { executor: "claude", models: { claude: "claude-opus-4-6", codex: "o4-mini" } },
    });
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "tool:codex"));
    await runDoWork();
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), { model: "o4-mini" });
  });

  it("drops a --model chosen for the other executor when tool: switches", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "tool:codex"));
    await runDoWork(["--model", "claude-opus-4-6"]);
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), { model: undefined });
  });

  it("uses the new executor's configured effort when tool: switches executor", async () => {
    // No `effort:` directive exists, but the level is keyed per executor, so a
    // switch must re-pick it — `max` is a Claude level codex does not accept.
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      doWork: { executor: "claude", effort: { claude: "max", codex: "medium" } },
    });
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "tool:codex"));
    await runDoWork();
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), {
      model: undefined,
      effort: "medium",
    });
  });

  it("drops an --effort chosen for the other executor when tool: switches", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "tool:codex"));
    await runDoWork(["--effort", "max"]);
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), {
      model: undefined,
      effort: undefined,
    });
  });

  it("keeps --effort when tool: names the executor that was going to run anyway", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "tool:claude"));
    await runDoWork(["--effort", "max"]);
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ effort: "max" });
  });

  it("ignores a directive in an older message", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => ({
      ...needsWork(n),
      messages: [
        { kind: "issue-comment" as const, author: "alice", body: "tool:codex", createdAt: "2026-01-01T00:00:00Z" },
        { kind: "issue-comment" as const, author: "alice", body: "carry on", createdAt: "2026-01-02T00:00:00Z" },
      ],
    }));
    await runDoWork();
    expect(mockInvokeClaude).toHaveBeenCalled();
    expect(mockInvokeCodex).not.toHaveBeenCalled();
  });

  it("leaves the directive in the prompt handed to the executor", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "rework it — tool:claude"));
    await runDoWork();
    expect(mockInvokeClaude.mock.calls[0][0]).toContain("tool:claude");
  });

  it("names the effective executor and its origin in the tick summary", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "tool:codex model:o3"));
    await runDoWork();
    expect(stdout).toContain("codex · model o3 — from the message");
  });

  it("names the effective executor in --dry-run", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "tool:codex model:o3"));
    await runDoWork(["--dry-run"]);
    expect(stdout).toContain("Executor     codex · model o3 — from the message");
  });

  it("reports the origin in --dry-run --json", async () => {
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "tool:codex model:o3"));
    await runDoWork(["--dry-run", "--json"]);
    const payload = JSON.parse(stdout) as { runs: Record<string, unknown>[] };
    expect(payload.runs[0]).toMatchObject({
      executor: "codex",
      model: "o3",
      executorSource: "message",
      modelSource: "message",
    });
  });

  it("reports the origin in --json for a completed item", async () => {
    gh.getIssueSurface.mockImplementation((n: number) =>
      gh.postMarker.mock.calls.length > 0 ? answered(n) : withDirective(n, "tool:codex"),
    );
    await runDoWork(["--json"]);
    const payload = JSON.parse(stdout) as { items: Record<string, unknown>[] };
    expect(payload.items[0]).toMatchObject({ executor: "codex", executorSource: "message" });
  });
});

describe("do-work invalid tool directive", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockImplementation((n: number) => withDirective(n, "tool:codexx"));
    mockInvokeCodex.mockResolvedValue(undefined);
  });

  it("invokes no executor", async () => {
    await runDoWork();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(mockInvokeCodex).not.toHaveBeenCalled();
  });

  it("explains the problem on the marker and names the valid values", async () => {
    await runDoWork();
    const text = gh.updateMarker.mock.calls[0][1] as string;
    expect(text).toContain("`tool:codexx`");
    expect(text).toContain("`claude`");
    expect(text).toContain("`codex`");
    expect(gh.deleteMarker).not.toHaveBeenCalled();
  });

  it("reports the item as failed and exits 2", async () => {
    await runDoWork();
    expect(stdout).toMatch(/#42 issue-discuss failed/);
    expect(exitCode).toBe(2);
  });

  it("does not stop another issue in the same tick", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42), issue(43)]);
    gh.getIssueSurface.mockImplementation((n: number) =>
      n === 42 ? withDirective(n, "tool:codexx") : needsWork(n),
    );
    await runDoWork();
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
  });

  it("does not consume a slot from the run cap", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42), issue(43)]);
    gh.getIssueSurface.mockImplementation((n: number) =>
      n === 42 ? withDirective(n, "tool:codexx") : needsWork(n),
    );
    await runDoWork(["--max-runs", "1"]);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
    expect(stdout).not.toMatch(/deferred/);
  });

  it("shows the refusal in --dry-run without a command", async () => {
    await runDoWork(["--dry-run"]);
    expect(stdout).toContain("Executor     refused —");
    expect(stdout).not.toContain("--dangerously-skip-permissions");
  });

  // The marker is posted before the refusal is decided and then edited in
  // place, which is what advances the answer boundary. Wording that implied a
  // real tick posts nothing would contradict the rest of `docs/do-work.md`.
  it("says a real tick still posts the marker and replaces it", async () => {
    await runDoWork(["--dry-run"]);
    expect(stdout).toContain(
      "Command      none; a real tick would post the working marker and then replace it with this refusal",
    );
  });
});

/* ── pre-flight repository hygiene ──────────────────────────────────────── */

describe("do-work pre-flight repository hygiene", () => {
  it("runs the pre-flight exactly once per tick, before any issue is discovered", async () => {
    const order: string[] = [];
    mockRunRepoHygiene.mockImplementation(() => {
      order.push("preflight");
      return { ...CLEAN_HYGIENE };
    });
    gh.listCandidateIssues.mockImplementation(() => {
      order.push("discover");
      return [];
    });

    await runDoWork();

    expect(order).toEqual(["preflight", "discover"]);
    expect(mockRunRepoHygiene).toHaveBeenCalledTimes(1);
  });

  it("passes the configured base branch, protected branches and dry-run flag", async () => {
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      doWork: { baseBranch: "main", protectedBranches: ["main", "master"] },
    });
    await runDoWork();
    expect(mockRunRepoHygiene).toHaveBeenCalledWith(
      expect.objectContaining({
        baseBranch: "main",
        protectedBranches: ["main", "master"],
        dryRun: false,
      }),
    );
  });

  it("reports the pre-flight in the human summary", async () => {
    mockRunRepoHygiene.mockReturnValue({
      rescue: {
        kind: "rescued",
        branch: "rescue/develop-20260910T054512Z",
        createdBranch: true,
        pr: 51,
        prUrl: "https://gh/pr/51",
        prCreated: true,
      },
      base: { ok: true },
      prunes: [{ kind: "deleted", branch: "old/thing" }],
      degraded: false,
    });

    await runDoWork();

    expect(stdout).toContain("Pre-flight:");
    expect(stdout).toContain("rescue/develop-20260910T054512Z");
    expect(stdout).toContain("opened draft PR #51");
    expect(stdout).toContain("deleted old/thing");
  });

  // Exit 1 stays reserved for "nothing was attempted", which is false by the
  // time the pre-flight has run and items have been discovered.
  it("turns an otherwise-healthy tick into exit 2 when the pre-flight degraded", async () => {
    mockRunRepoHygiene.mockReturnValue({
      rescue: { kind: "failed", step: "push", detail: "rejected" },
      base: { ok: true },
      prunes: [],
      degraded: true,
    });

    await runDoWork();

    expect(exitCode).toBe(2);
    expect(stdout).toContain("push failed");
    expect(stdout).toContain("nothing was discarded");
  });

  it("stays at exit 0 when the pre-flight is healthy and there is nothing to do", async () => {
    await runDoWork();
    expect(exitCode).toBeUndefined();
    expect(stdout).toContain("nothing to do");
  });

  it("tells the pre-flight it is a dry run, and reports its plan", async () => {
    mockRunRepoHygiene.mockReturnValue({
      rescue: { kind: "would-rescue", branch: "rescue/develop-20260910T054512Z", createdBranch: true },
      base: { ok: true },
      prunes: [
        { kind: "would-delete", branch: "old/thing" },
        { kind: "would-rescue", branch: "fix/wip", unmergedCommits: 4 },
      ],
      degraded: false,
    });

    await runDoWork(["--dry-run"]);

    expect(mockRunRepoHygiene).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(stdout).toContain("would rescue onto rescue/develop-20260910T054512Z");
    expect(stdout).toContain("would delete old/thing");
    expect(stdout).toContain("would rescue fix/wip (4 unmerged commit(s))");
    expect(stdout).toContain("nothing was rescued, pruned, pulled");
  });

  it("carries the pre-flight report in the --json payload of a real tick", async () => {
    mockRunRepoHygiene.mockReturnValue({
      rescue: { kind: "clean" },
      base: { ok: false, step: "pull", detail: "not possible to fast-forward" },
      prunes: [{ kind: "kept", branch: "x", reason: "lookup-failed", detail: "gh: HTTP 502" }],
      degraded: true,
    });

    await runDoWork(["--json"]);

    const payload = JSON.parse(stdout) as {
      preflight: { base: { ok: boolean; step: string }; degraded: boolean; prunes: unknown[] };
      exitCode: number;
    };
    expect(payload.preflight.base).toEqual({
      ok: false,
      step: "pull",
      detail: "not possible to fast-forward",
    });
    expect(payload.preflight.degraded).toBe(true);
    expect(payload.preflight.prunes).toHaveLength(1);
    expect(payload.exitCode).toBe(2);
  });

  it("carries the pre-flight report in the --dry-run --json payload", async () => {
    mockRunRepoHygiene.mockReturnValue({
      rescue: { kind: "would-rescue", branch: "rescue/develop-1", createdBranch: true },
      base: { ok: true },
      prunes: [{ kind: "would-delete", branch: "old/thing" }],
      degraded: false,
    });

    await runDoWork(["--dry-run", "--json"]);

    const payload = JSON.parse(stdout) as {
      dryRun: boolean;
      preflight: { rescue: { kind: string }; prunes: { kind: string }[] };
    };
    expect(payload.dryRun).toBe(true);
    expect(payload.preflight.rescue.kind).toBe("would-rescue");
    expect(payload.preflight.prunes[0].kind).toBe("would-delete");
  });

  it("does not run the pre-flight at all when the run lock is held", async () => {
    mockAcquireRunLock.mockReturnValue({
      ok: false,
      suspect: false,
      heldBy: { pid: 4242, host: "box", startedAt: "2026-09-10T05:00:00Z", command: "do-work" },
    });

    await runDoWork();

    // Every step writes to this one checkout, so the lock has to gate it.
    expect(mockRunRepoHygiene).not.toHaveBeenCalled();
  });
});

/* ── operation log ──────────────────────────────────────────────────────── */

describe("do-work operation log", () => {
  interface RecordedTick {
    command: string;
    repo: string | null;
    timestamp: Date;
    durationMs: number;
    exitCode: number;
    note?: string;
    items: {
      subject: string;
      turn: string | null;
      outcome: string;
      detail: string;
      ranExecutor: boolean;
      executor?: string;
      model?: string;
      effort?: string;
    }[];
  }

  function recorded(): RecordedTick {
    expect(mockRecordTick).toHaveBeenCalledTimes(1);
    return mockRecordTick.mock.calls[0][0] as RecordedTick;
  }

  it("records a tick that answered an issue, with the resolved executor", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockReturnValue(needsWork(42));
    const before = Date.now();
    await runDoWork();

    const tick = recorded();
    expect(tick.command).toBe("do-work");
    expect(tick.repo).toBe("acme/widget");
    // `>= 0` would be true by construction and would still pass if `startedAt`
    // were captured in the wrong place; pin it to a real window instead.
    expect(tick.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(tick.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    expect(tick.durationMs).toBeLessThanOrEqual(Date.now() - before);
    expect(tick.note).toBeUndefined();
    expect(tick.items).toHaveLength(1);
    expect(tick.items[0]).toMatchObject({
      subject: "#42",
      turn: "issue-discuss",
      ranExecutor: true,
      executor: "claude",
    });
    expect(tick.exitCode).toBe(exitCode ?? 0);
  });

  it("records a tick that found nothing, so a silent loop is still visible", async () => {
    gh.listCandidateIssues.mockReturnValue([]);
    await runDoWork();

    const tick = recorded();
    expect(tick.items).toEqual([]);
    expect(tick.exitCode).toBe(0);
  });

  it("records a deferred item as not having run the executor", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42), issue(43)]);
    gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));
    await runDoWork(["--max-runs", "1"]);

    const tick = recorded();
    const deferred = tick.items.find((item) => item.outcome === "deferred");
    expect(deferred).toBeDefined();
    expect(deferred?.ranExecutor).toBe(false);
    expect(tick.items.filter((item) => item.ranExecutor)).toHaveLength(1);
  });

  it("records a tick that threw, so an exploding loop leaves a trace", async () => {
    gh.listCandidateIssues.mockImplementation(() => {
      throw new Error("gh exploded");
    });
    await runDoWork();

    const tick = recorded();
    expect(tick.exitCode).toBe(1);
    expect(tick.items).toEqual([]);
  });

  it("marks a run blocked by the lock, which is otherwise indistinguishable from cron not firing", async () => {
    mockAcquireRunLock.mockReturnValue({
      ok: false,
      heldBy: { pid: 4242, startedAt: "2026-01-10T00:00:00Z", host: "runner-1", command: "do-work", token: "t" },
      suspect: false,
    });
    await runDoWork();

    const tick = recorded();
    expect(tick.note).toBe("lock-held");
    expect(tick.items).toEqual([]);
    expect(tick.exitCode).toBe(0);
  });

  it("logs repo=null rather than failing when the slug cannot be resolved", async () => {
    gh.getRepoSlug.mockImplementation(() => {
      throw new Error("not a git repository");
    });
    gh.listCandidateIssues.mockReturnValue([]);
    await runDoWork();

    expect(recorded().repo).toBeNull();
  });

  // A misconfigured loop exits through `fail()` before the tick begins. Without
  // a line here it is indistinguishable, in the log, from cron having stopped
  // firing — which is the one confusion this file exists to remove.
  it("records a configuration error that stops the tick before it starts", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, allowedUsers: [] });

    await runDoWork();

    expect(exitCode).toBe(1);
    const tick = recorded();
    expect(tick.note).toBe("config-error");
    expect(tick.exitCode).toBe(1);
    expect(tick.items).toEqual([]);
  });

  it("writes nothing for a configuration error during a dry run", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, allowedUsers: [] });

    await runDoWork(["--dry-run"]);

    expect(exitCode).toBe(1);
    expect(mockRecordTick).not.toHaveBeenCalled();
  });

  it("writes nothing for a dry run", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockReturnValue(needsWork(42));
    await runDoWork(["--dry-run"]);

    expect(mockRecordTick).not.toHaveBeenCalled();
  });

  it("leaves the --json payload untouched", async () => {
    // The log is a side channel: the documented JSON contract must not gain a key.
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockReturnValue(needsWork(42));
    await runDoWork(["--json"]);

    const payload = JSON.parse(stdout) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["dryRun", "exitCode", "items", "plan", "preflight"]);
    expect(mockRecordTick).toHaveBeenCalledTimes(1);
  });
});

/* ── the orphan pull-request pass ───────────────────────────────────────── */

const ORPHAN_PR: PullRequestRef = {
  number: 61,
  url: "https://gh/pr/61",
  title: "Bump lodash",
  headRefName: "dependabot/npm_and_yarn/lodash-4.17.21",
  baseRefName: "develop",
  isCrossRepository: false,
  state: "OPEN",
  isDraft: false,
  updatedAt: "2026-01-08T00:00:00Z",
};

/** A matching orphan candidate, as the link map reports it. */
function orphanCandidate(overrides: Partial<PullRequestRef> = {}, labels = ["automated"]) {
  return { pr: { ...ORPHAN_PR, ...overrides }, labels, assignees: [] as string[] };
}

function orphanSurface(overrides: Partial<PrSurface> = {}): PrSurface {
  return {
    pr: ORPHAN_PR,
    assignees: [],
    messages: [message("alice", "2026-01-08T00:00:00Z", "pr-comment")],
    threads: [],
    ...overrides,
  };
}

describe("do-work orphan pull-request pass", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([]);
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map(),
      defaultBranch: "main",
      orphans: [orphanCandidate()],
    });
    gh.getPrSurface.mockReturnValue(orphanSurface());
    mockPreparePrBranch.mockReturnValue({ ok: true, branch: ORPHAN_PR.headRefName });
  });

  it("runs one pr-orphan turn on the head branch and marks the pull request", async () => {
    await runDoWork();
    expect(mockPreparePrBranch).toHaveBeenCalledWith("dependabot/npm_and_yarn/lodash-4.17.21");
    expect(mockPrepareBaseBranch).not.toHaveBeenCalled();
    expect(gh.postMarker).toHaveBeenCalledWith("pr", 61, expect.stringContaining("working"));
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
    expect(stdout).toMatch(/PR #61 pr-orphan on dependabot/);
  });

  it("uses the orphan frame and carries no issue context", async () => {
    await runDoWork();
    const prompt = mockInvokeClaude.mock.calls[0][0] as string;
    expect(prompt).toContain("Turn: pr-orphan");
    expect(prompt).toMatch(/not linked to any issue/);
    expect(prompt).not.toContain("Issue #");
  });

  it("neither assigns anything nor touches the issue link", async () => {
    await runDoWork();
    expect(gh.assignIssueToAgent).not.toHaveBeenCalled();
    expect(mockAddClosesRefToPr).not.toHaveBeenCalled();
    expect(gh.getIssueSurface).not.toHaveBeenCalled();
    // Not even the pull request, which has no assignee: see the note on the
    // orphan item in `workDetection.ts`.
    expect(gh.assignPrToAgent).not.toHaveBeenCalled();
  });

  it("--dry-run says the orphan pull request is not claimed rather than staying silent", async () => {
    await runDoWork(["--dry-run"]);
    expect(stdout).toContain("Assign       pull request #61 not claimed (orphan pass)");
  });

  it("does nothing when no authorized account has posted", async () => {
    // A freshly opened Dependabot pull request: the label alone is not work.
    gh.getPrSurface.mockReturnValue(
      orphanSurface({ messages: [message("dependabot[bot]", "2026-01-08T00:00:00Z", "pr-comment")] }),
    );
    await runDoWork();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(gh.postMarker).not.toHaveBeenCalled();
    expect(stdout).toMatch(/PR #61 nothing to do/);
  });

  it("does not discover an orphan pull request that fails the discovery filter", async () => {
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map(),
      defaultBranch: "main",
      orphans: [orphanCandidate({}, ["dependencies"])],
    });
    await runDoWork();
    expect(gh.getPrSurface).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  // `--limit` is `gh issue list --limit`: it bounds how many *issues* are
  // fetched and says nothing about the orphan pass, which reads candidates out
  // of a link map that is paged exhaustively for correctness anyway. Pinned
  // because it is documented, and a later `.slice(0, limit)` would look tidy.
  it("does not bound the orphan pass by --limit", async () => {
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map(),
      defaultBranch: "main",
      orphans: [
        orphanCandidate({ number: 61, headRefName: "dependabot/a" }),
        orphanCandidate({ number: 62, headRefName: "dependabot/b" }),
        orphanCandidate({ number: 63, headRefName: "dependabot/c" }),
      ],
    });
    gh.getPrSurface.mockImplementation((n: number) =>
      orphanSurface({ pr: { ...ORPHAN_PR, number: n, headRefName: `dependabot/${String(n)}` } }),
    );
    mockPreparePrBranch.mockImplementation((branch: string) => ({ ok: true, branch }));
    await runDoWork(["--limit", "1"]);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(3);
  });

  // GitHub allows two open pull requests from one head branch to different
  // bases. Running both in a tick would put two model sessions on the same
  // checkout back to back, the second inheriting the first's leftovers.
  it("works one pull request per head branch, keeping the issue pass's", async () => {
    const shared = "fix/x";
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map([[42, [{ ...ORPHAN_PR, number: 57, headRefName: shared }]]]),
      defaultBranch: "main",
      orphans: [orphanCandidate({ number: 62, headRefName: shared })],
    });
    gh.getPrSurface.mockImplementation((n: number) =>
      orphanSurface({ pr: { ...ORPHAN_PR, number: n, headRefName: shared } }),
    );
    mockPreparePrBranch.mockReturnValue({ ok: true, branch: shared });
    await runDoWork();

    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
    expect(gh.postMarker).toHaveBeenCalledWith("pr", 57, expect.stringContaining("working"));
    expect(gh.postMarker).not.toHaveBeenCalledWith("pr", 62, expect.anything());
    expect(stdout).toMatch(/PR #62 nothing to do/);
    expect(stdout).toMatch(/shares its head branch \(fix\/x\) with pull request #57/);
  });

  it("matches the label case-insensitively", async () => {
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map(),
      defaultBranch: "main",
      orphans: [orphanCandidate({}, ["AUTOMATED"])],
    });
    await runDoWork();
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
  });

  it("matches on assignees when that is the configured technique", async () => {
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      issueDiscoveryTechnique: "assignee",
      issueDiscoveryValue: "alice",
    });
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map(),
      defaultBranch: "main",
      orphans: [{ pr: ORPHAN_PR, labels: [], assignees: ["Alice"] }],
    });
    await runDoWork();
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
  });

  it("matches on the title when that is the configured technique", async () => {
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      issueDiscoveryTechnique: "title-contains",
      issueDiscoveryValue: "lodash",
    });
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map(),
      defaultBranch: "main",
      orphans: [{ pr: ORPHAN_PR, labels: [], assignees: [] }],
    });
    await runDoWork();
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a fork", { isCrossRepository: true }, /comes from a fork/],
    ["the repository default branch as its head", { headRefName: "main" }, /protected branch \(main\)/],
    ["the base branch as its head", { headRefName: "develop" }, /protected branch \(develop\)/],
  ])("skips %s without invoking anything", async (_what, overrides, detail) => {
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map(),
      defaultBranch: "main",
      orphans: [orphanCandidate(overrides)],
    });
    gh.getPrSurface.mockReturnValue(orphanSurface({ pr: { ...ORPHAN_PR, ...overrides } }));
    await runDoWork();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(mockPreparePrBranch).not.toHaveBeenCalled();
    expect(gh.postMarker).not.toHaveBeenCalled();
    expect(stdout).toMatch(/PR #61 nothing to do/);
    expect(stdout).toMatch(detail);
  });

  it("skips an item that gained a closing reference before it ran", async () => {
    // A maintainer added `Closes #42` while an earlier item was running: the
    // issue pass owns it now, and running it here would use the wrong prompt.
    let reads = 0;
    gh.getOpenPrLinkMap.mockImplementation(() => {
      reads++;
      return reads === 1
        ? { byIssue: new Map(), defaultBranch: "main", orphans: [orphanCandidate()] }
        : { byIssue: new Map([[42, [ORPHAN_PR]]]), defaultBranch: "main", orphans: [] };
    });
    await runDoWork();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(gh.postMarker).not.toHaveBeenCalled();
    expect(stdout).toMatch(/no longer actionable: pull request #61 now closes #42/);
    expect(exitCode).toBe(2);
  });

  it("skips an item that stopped being an open pull request before it ran", async () => {
    let reads = 0;
    gh.getOpenPrLinkMap.mockImplementation(() => {
      reads++;
      return reads === 1
        ? { byIssue: new Map(), defaultBranch: "main", orphans: [orphanCandidate()] }
        : { byIssue: new Map(), defaultBranch: "main", orphans: [] };
    });
    await runDoWork();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(stdout).toMatch(/no longer an open pull request/);
  });

  it("reconciles the marker on the pull request", async () => {
    gh.getPrSurface.mockImplementation(() =>
      gh.postMarker.mock.calls.length > 0
        ? orphanSurface({
            messages: [
              message("alice", "2026-01-08T00:00:00Z", "pr-comment"),
              message("automata-bot", "2026-01-10T00:05:00Z", "pr-comment"),
            ],
          })
        : orphanSurface(),
    );
    await runDoWork();
    expect(gh.deleteMarker).toHaveBeenCalledWith(MARKER);
    expect(exitCode).toBeUndefined();
    expect(stdout).toMatch(/PR #61 pr-orphan answered/);
  });

  it("runs after the issues and shares the run cap with them", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));
    await runDoWork(["--max-runs", "1"]);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
    expect(mockInvokeClaude.mock.calls[0][0]).toContain("Issue #42");
    expect(stdout).toMatch(/PR #61 pr-orphan deferred — run cap of 1 reached/);
  });

  it("runs both passes when the cap allows it, issues first", async () => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));
    await runDoWork(["--max-runs", "2"]);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(2);
    expect(mockInvokeClaude.mock.calls[0][0]).toContain("Issue #42");
    expect(mockInvokeClaude.mock.calls[1][0]).toContain("Turn: pr-orphan");
  });

  it("reports the item with a null issue and its pull request number in --json", async () => {
    await runDoWork(["--json"]);
    const payload = JSON.parse(stdout) as { plan: Record<string, unknown>[]; items: Record<string, unknown>[] };
    expect(payload.items[0]).toMatchObject({ issue: null, pr: 61, title: "Bump lodash", turn: "pr-orphan" });
    expect(payload.plan[0]).toMatchObject({ issue: null, pr: 61, turn: "pr-orphan" });
  });

  it("describes the item in a dry run without touching anything", async () => {
    await runDoWork(["--dry-run"]);
    expect(stdout).toMatch(/Pull request #61 — Bump lodash/);
    expect(stdout).toMatch(/Turn {9}pr-orphan/);
    expect(stdout).toMatch(/Marker {7}would post on pull request #61/);
    expect(gh.postMarker).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it("honours a tool directive in the triggering pull request message", async () => {
    gh.getPrSurface.mockReturnValue(
      orphanSurface({
        messages: [
          {
            kind: "pr-comment",
            author: "alice",
            body: "rebase this tool:codex",
            createdAt: "2026-01-08T00:00:00Z",
          },
        ],
      }),
    );
    await runDoWork();
    expect(mockInvokeCodex).toHaveBeenCalledTimes(1);
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it("uses a configured prOrphan prompt", async () => {
    mockReadConfig.mockReturnValue({
      ...CONFIG,
      doWork: { prompts: { prOrphan: "CUSTOM ORPHAN FRAME" } },
    });
    await runDoWork();
    expect(mockInvokeClaude.mock.calls[0][0] as string).toMatch(/^CUSTOM ORPHAN FRAME/);
  });

  it("rejects an unrecognised key under doWork.prompts", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, doWork: { prompts: { prOrphaned: "x" } } });
    await runDoWork();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/doWork\.prompts\.prOrphaned is not a recognised setting/);
    expect(stderr).toMatch(/prOrphan/);
  });
});

describe("do-work --pr", () => {
  beforeEach(() => {
    gh.listCandidateIssues.mockReturnValue([issue(42)]);
    gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map(),
      defaultBranch: "main",
      orphans: [orphanCandidate()],
    });
    gh.getPrSurface.mockReturnValue(orphanSurface());
    mockPreparePrBranch.mockReturnValue({ ok: true, branch: ORPHAN_PR.headRefName });
  });

  it("restricts the tick to that pull request and skips the issue pass", async () => {
    await runDoWork(["--pr", "61"]);
    expect(gh.listCandidateIssues).not.toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
    expect(mockInvokeClaude.mock.calls[0][0]).toContain("Turn: pr-orphan");
  });

  it("processes it anyway with a note when it does not match the filter", async () => {
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map(),
      defaultBranch: "main",
      orphans: [orphanCandidate({}, ["dependencies"])],
    });
    await runDoWork(["--pr", "61"]);
    expect(stderr).toMatch(/pull request #61 does not match the configured discovery filter/);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
  });

  it("refuses a pull request that closes an issue of this repository", async () => {
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map([[42, [ORPHAN_PR]]]),
      defaultBranch: "main",
      orphans: [],
    });
    await runDoWork(["--pr", "61"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/closes issue #42 of this repository/);
    expect(stderr).toMatch(/--issue 42/);
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it("refuses a number that is not an open pull request here", async () => {
    await runDoWork(["--pr", "999"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/#999 is not an open pull request of this repository/);
  });

  it("rejects a non-numeric value", async () => {
    await runDoWork(["--pr", "61junk"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--pr must be a positive integer/);
  });

  // Both refusals are resolved out of the link map, so they happen *inside* the
  // run lock. Exiting the process there would skip the release and leave every
  // tick on another host reporting "another instance is already running" until
  // the lock went stale — up to two hours by default, for a typo.
  it.each([
    ["a number that is no pull request here", ["--pr", "999"]],
    ["a number the issue pass owns", ["--pr", "57"]],
  ])("releases the run lock when it refuses %s", async (_what, args) => {
    gh.getOpenPrLinkMap.mockReturnValue({
      byIssue: new Map([[42, [{ ...ORPHAN_PR, number: 57 }]]]),
      defaultBranch: "main",
      orphans: [orphanCandidate()],
    });
    await runDoWork(args);
    expect(exitCode).toBe(1);
    expect(mockRelease).toHaveBeenCalled();
  });

  it("runs both passes restricted when --issue is given too", async () => {
    await runDoWork(["--issue", "42", "--pr", "61"]);
    expect(gh.listCandidateIssues).toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalledTimes(2);
  });

  it("suppresses the orphan pass when only --issue is given", async () => {
    await runDoWork(["--issue", "42"]);
    expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
    expect(mockInvokeClaude.mock.calls[0][0]).toContain("Issue #42");
  });

  // The work log identifies an item by number. An orphan turn has no issue, so
  // a bare `#61` there would read as issue 61 to whoever greps the log — and in
  // a tick that ran both passes the two kinds sit on adjacent lines.
  it("names an orphan by its pull request in the operation log", async () => {
    await runDoWork();
    const tick = mockRecordTick.mock.calls[0][0] as { items: { subject: string; turn: string }[] };
    expect(tick.items.map((i) => [i.subject, i.turn])).toEqual([
      ["#42", "issue-discuss"],
      ["PR #61", "pr-orphan"],
    ]);
  });
});
