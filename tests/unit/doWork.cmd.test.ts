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

vi.mock("../../src/run/runLock.js", () => ({
  acquireRunLock: (...a: unknown[]) => mockAcquireRunLock(...a),
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
  return { pr: PR, messages: [], threads: [], ...overrides };
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
  gh.getOpenPrLinkMap.mockReturnValue({ byIssue: new Map(), defaultBranch: "main" });
  gh.listCandidateIssues.mockReturnValue([]);
  gh.postMarker.mockReturnValue(MARKER);
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
    expect(stdout).toMatch(/issues need an answer/);
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
    expect(stdout).toMatch(/0 of 0 issues need an answer/);
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
    gh.getOpenPrLinkMap.mockReturnValue({ byIssue: new Map([[42, [PR]]]), defaultBranch: "main" });
    gh.getPrSurface.mockImplementation(() =>
      gh.postMarker.mock.calls.length > 0
        ? prSurface({
            threads: [
              {
                path: "src/index.ts",
                line: 1,
                isResolved: false,
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
    gh.getOpenPrLinkMap.mockReturnValue({ byIssue: new Map([[42, [PR]]]), defaultBranch: "main" });
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
    mockGetCurrentBranchPr.mockReturnValue({ number: 57, url: "https://gh/pr/57", body: "some body" });
    await runDoWork();
    expect(mockAddClosesRefToPr).toHaveBeenCalledWith(57, 42);
  });

  it("leaves the body untouched when the reference is already present", async () => {
    mockGetCurrentBranchPr.mockReturnValue({ number: 57, url: "https://gh/pr/57", body: "Closes #42" });
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
    mockGetCurrentBranchPr.mockReturnValue({ number: 99, url: "https://gh/pr/99", body: "release" });
    await runDoWork();
    expect(mockGetCurrentBranchPr).not.toHaveBeenCalled();
    expect(mockAddClosesRefToPr).not.toHaveBeenCalled();
    expect(stderr).toMatch(/no branch was created/);
  });

  it("warns rather than failing when the link cannot be repaired", async () => {
    mockGetCurrentBranchPr.mockReturnValue({ number: 57, url: "u", body: "" });
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
      return { byIssue: mapReads >= 3 ? new Map([[43, [PR]]]) : new Map(), defaultBranch: "main" };
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
    expect(stdout).toMatch(/1 of 1 issues need an answer/);
    expect(stdout).toMatch(/#42 issue-discuss on develop/);
    expect(stdout).toMatch(/will assign to the agent/);
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
    expect(stdout).toContain("would assign to automata-bot");
    expect(stdout).toContain("Marker       would post on issue #42");
    expect(stdout).toContain("Executor     claude");
    expect(stdout).toContain("Permissions  bypassed");
    expect(stdout).toContain("Command that would be launched:");
    expect(stdout).toContain("Dry run: nothing was assigned, posted, checked out or executed.");
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
    gh.getOpenPrLinkMap.mockReturnValue({ byIssue: new Map([[42, [PR]]]), defaultBranch: "main" });
    gh.getPrSurface.mockReturnValue(
      prSurface({ messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")] }),
    );
    await runDoWork(["--dry-run"]);
    expect(stdout).toContain("Branch       feature/042 (would check out and fast-forward)");
    expect(stdout).toContain("Marker       would post on pull request #57");
  });

  it("--dry-run still changes nothing while printing the command", async () => {
    await runDoWork(["--dry-run"]);
    expect(gh.assignIssueToAgent).not.toHaveBeenCalled();
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
    expect(stdout).toMatch(/issues need an answer/);
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
        title: "Issue 42",
        turn: "issue-discuss",
        outcome: "answered-no-reply",
        detail: expect.any(String),
        ranExecutor: true,
        executor: "claude",
        model: null,
        executorSource: "default",
        modelSource: "none",
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
});
