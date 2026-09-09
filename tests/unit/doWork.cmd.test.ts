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

vi.mock("../../src/git/workspaceService.js", () => ({
  prepareBaseBranch: (...a: unknown[]) => mockPrepareBaseBranch(...a),
  preparePrBranch: (...a: unknown[]) => mockPreparePrBranch(...a),
}));

vi.mock("../../src/run/runLock.js", () => ({
  acquireRunLock: (...a: unknown[]) => mockAcquireRunLock(...a),
}));

vi.mock("../../src/claude/claudeService.js", () => ({
  invokeClaudeCode: (...a: unknown[]) => mockInvokeClaude(...a),
}));

vi.mock("../../src/codex/codexService.js", () => ({
  invokeCodexCode: (...a: unknown[]) => mockInvokeCodex(...a),
}));

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
    messages: [message("alice", "2026-01-01T00:00:00Z", "issue-body")],
  };
}

/** An issue surface where the agent has already answered. */
function settled(number: number): IssueSurface {
  return {
    issue: issue(number),
    state: "OPEN",
    assignees: ["automata-bot"],
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
  gh.getOpenPrLinkMap.mockReturnValue(new Map());
  gh.listCandidateIssues.mockReturnValue([]);
  gh.postMarker.mockReturnValue(MARKER);
  mockPrepareBaseBranch.mockReturnValue({ ok: true, branch: "develop" });
  mockPreparePrBranch.mockReturnValue({ ok: true, branch: "feature/042" });
  mockGetCurrentBranchPr.mockReturnValue(null);
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

  it("warns but proceeds when the login differs from the agent without being authorized", async () => {
    gh.getAuthenticatedLogin.mockReturnValue("some-other-bot");
    gh.listCandidateIssues.mockReturnValue([]);
    await runDoWork();
    expect(exitCode).toBeUndefined();
    expect(stderr).toMatch(/authenticated as "some-other-bot" but agentUser is "automata-bot"/);
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
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ yolo: true, verbose: true });
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
    gh.getIssueSurface
      .mockReturnValueOnce(needsWork(42))
      .mockReturnValueOnce({
        ...needsWork(42),
        messages: [message("alice", "2026-01-01T00:00:00Z", "issue-body"), message("automata-bot", "2026-01-10T00:05:00Z")],
      });
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
    expect(body).toMatch(/Reply on this issue/);
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
    gh.getIssueSurface
      .mockReturnValueOnce(needsWork(42))
      .mockReturnValueOnce({
        ...needsWork(42),
        messages: [message("automata-bot", "2026-01-10T00:05:00Z")],
      });
    mockInvokeClaude.mockRejectedValue(new Error("claude exited with code 1"));
    await runDoWork();
    expect(gh.deleteMarker).toHaveBeenCalled();
    expect(stdout).toMatch(/answered, but the run reported/);
    expect(exitCode).toBeUndefined();
  });

  it("keeps the marker when the surface cannot be re-read", async () => {
    gh.getIssueSurface.mockReturnValueOnce(needsWork(42)).mockImplementationOnce(() => {
      throw new Error("gh rate limited");
    });
    await runDoWork();
    expect(gh.deleteMarker).not.toHaveBeenCalled();
    expect(stderr).toMatch(/could not re-read issue #42/);
  });

  it("warns but still reports the item as answered when the delete fails", async () => {
    gh.getIssueSurface
      .mockReturnValueOnce(needsWork(42))
      .mockReturnValueOnce({
        ...needsWork(42),
        messages: [message("automata-bot", "2026-01-10T00:05:00Z")],
      });
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

  it("counts a reply inside a review thread as an answer on a build turn", async () => {
    gh.getIssueSurface.mockReturnValue(settled(42));
    gh.getOpenPrLinkMap.mockReturnValue(new Map([[42, [PR]]]));
    gh.getPrSurface
      .mockReturnValueOnce(prSurface({ messages: [message("alice", "2026-01-07T00:00:00Z", "pr-comment")] }))
      .mockReturnValueOnce(
        prSurface({
          threads: [
            {
              path: "src/index.ts",
              line: 1,
              isResolved: false,
              comments: [message("automata-bot", "2026-01-10T00:05:00Z", "thread-comment")],
            },
          ],
        }),
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
    gh.getOpenPrLinkMap.mockReturnValue(new Map([[42, [PR]]]));
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
    gh.getIssueSurface.mockImplementation((n: number) => needsWork(n));
    await runDoWork(["--issue", "99"]);
    expect(stderr).toMatch(/does not match the configured discovery filter/);
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

  it("--json emits the plan on stdout with progress on stderr", async () => {
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
      { issue: 42, title: "Issue 42", turn: "issue-discuss", outcome: "answered-no-reply", detail: expect.any(String) },
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
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), { yolo: true, model: "o3" });
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it("always bypasses permission prompts, since an unattended run cannot answer one", async () => {
    await runDoWork();
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ yolo: true });
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
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), { yolo: true, model: "o4-mini" });
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
    expect(mockInvokeCodex).toHaveBeenCalledWith(expect.any(String), { yolo: true, model: "o4-mini" });
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

  it("forwards --silent as non-verbose to Claude", async () => {
    await runDoWork(["--silent"]);
    expect(mockInvokeClaude.mock.calls[0][1]).toMatchObject({ verbose: false });
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
