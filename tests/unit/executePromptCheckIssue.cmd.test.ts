import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockReadConfig = vi.fn(() => ({}) as Record<string, unknown>);
const mockGetIssueConversation = vi.fn();
const mockPostComment = vi.fn();
const mockInvokeClaudeCode = vi.fn();
const mockInvokeCodexCode = vi.fn();

vi.mock("../../src/git/gitService.js", () => ({
  getCurrentBranch: vi.fn(),
  getPrInfo: vi.fn(),
  resolveCurrentBranchComments: vi.fn(),
}));

vi.mock("../../src/config/configStore.js", () => ({
  readConfig: () => mockReadConfig(),
  writeConfig: vi.fn(),
  DEFAULT_SONAR_PROMPT: "Default: fix sonar issues.",
  DEFAULT_FIX_COMMENTS_PROMPT: "Default: address each review comment.",
  DEFAULT_CHECK_ISSUE_PROMPT: "Default: act on the new issue messages.",
}));

vi.mock("../../src/config/githubService.js", () => ({
  getIssueConversation: (...args: unknown[]) => mockGetIssueConversation(...args),
  postComment: (...args: unknown[]) => mockPostComment(...args),
}));

vi.mock("../../src/claude/claudeService.js", () => ({
  invokeClaudeCode: (...args: unknown[]) => mockInvokeClaudeCode(...args),
}));

vi.mock("../../src/codex/codexService.js", () => ({
  invokeCodexCode: (...args: unknown[]) => mockInvokeCodexCode(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONFIG = { allowedUsers: ["alice", "bob"], agentUser: "agent-bot" };

/** Issue where an allowed user replied after the agent's last comment. */
function conversationWithNewMessage() {
  return {
    number: 34,
    title: "Check new messages in gh",
    body: "Please add the check-issue command.",
    url: "https://github.com/o/r/issues/34",
    author: "alice",
    createdAt: "2026-09-09T05:00:00Z",
    comments: [
      { id: "c1", author: "agent-bot", body: "working", createdAt: "2026-09-09T06:00:00Z" },
      { id: "c2", author: "stranger", body: "please also do my thing", createdAt: "2026-09-09T06:30:00Z" },
      { id: "c3", author: "bob", body: "also handle the --force flag", createdAt: "2026-09-09T07:00:00Z" },
    ],
  };
}

/** Issue where the agent spoke last, so there is nothing new. */
function conversationWithoutNewMessage() {
  return {
    ...conversationWithNewMessage(),
    comments: [
      { id: "c1", author: "alice", body: "please fix", createdAt: "2026-09-09T06:00:00Z" },
      { id: "c2", author: "agent-bot", body: "done", createdAt: "2026-09-09T07:00:00Z" },
    ],
  };
}

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
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  }) as never);

  return {
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    get exitCode() { return exitCode; },
  };
}

async function run(...args: string[]) {
  const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
  await executePromptCommand.parseAsync(["node", "execute-prompt", "check-issue", ...args]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("execute-prompt check-issue command", () => {
  let out: ReturnType<typeof captureStreams>;

  beforeEach(() => {
    mockReadConfig.mockReset().mockReturnValue({ ...CONFIG });
    mockGetIssueConversation.mockReset().mockReturnValue(conversationWithNewMessage());
    mockPostComment.mockReset().mockReturnValue(undefined);
    mockInvokeClaudeCode.mockReset().mockResolvedValue(undefined);
    mockInvokeCodexCode.mockReset();
    out = captureStreams();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ── New-message detection ──────────────────────────────────────────────────

  it("invokes the AI when an allowed user posted after the agent's last comment", async () => {
    await run("34", "--with", "claude");

    expect(mockGetIssueConversation).toHaveBeenCalledWith(34);
    expect(mockInvokeClaudeCode).toHaveBeenCalledOnce();
    expect(out.stdout).toContain("Found 1 new message on issue #34");
  });

  it("includes the issue number, title, URL and conversation in the prompt", async () => {
    await run("34", "--with", "claude");

    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).toContain("Default: act on the new issue messages.");
    expect(prompt).toContain("Issue #34: Check new messages in gh");
    expect(prompt).toContain("https://github.com/o/r/issues/34");
    expect(prompt).toContain("Please add the check-issue command.");
    expect(prompt).toContain("also handle the --force flag");
    expect(prompt).toContain("NEW since last agent run");
  });

  it("omits messages from users who are neither allowed nor the agent", async () => {
    await run("34", "--with", "claude");

    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).not.toContain("please also do my thing");
    expect(prompt).not.toContain("stranger");
  });

  it("uses a custom prompt when prompts.checkIssue is configured", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, prompts: { checkIssue: "Custom: read the thread." } });

    await run("34", "--with", "claude");

    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).toContain("Custom: read the thread.");
    expect(prompt).not.toContain("Default: act on the new issue messages.");
  });

  it("posts the execution marker comment before invoking the AI", async () => {
    const order: string[] = [];
    mockPostComment.mockImplementation(() => { order.push("comment"); });
    mockInvokeClaudeCode.mockImplementation(() => { order.push("ai"); return Promise.resolve(); });

    await run("34", "--with", "claude");

    expect(order).toEqual(["comment", "ai"]);
    const [issueNumber, body] = mockPostComment.mock.calls[0] as [number, string];
    expect(issueNumber).toBe(34);
    expect(body).toContain("automata check-issue");
    expect(body).toContain("1 new message");
  });

  it("does nothing and exits 0 when the agent posted the newest message", async () => {
    mockGetIssueConversation.mockReturnValue(conversationWithoutNewMessage());

    await run("34", "--with", "claude");

    expect(mockInvokeClaudeCode).not.toHaveBeenCalled();
    expect(mockInvokeCodexCode).not.toHaveBeenCalled();
    expect(mockPostComment).not.toHaveBeenCalled();
    expect(out.exitCode).toBeUndefined();
    expect(out.stdout).toContain("No new messages from allowed users on issue #34");
    expect(out.stdout).toContain("2026-09-09T07:00:00Z");
  });

  it("does not invoke the AI when only a non-allowed user posted after the agent", async () => {
    const conversation = conversationWithNewMessage();
    conversation.comments = conversation.comments.filter((c) => c.author !== "bob");
    mockGetIssueConversation.mockReturnValue(conversation);

    await run("34", "--with", "claude");

    expect(mockInvokeClaudeCode).not.toHaveBeenCalled();
    expect(mockPostComment).not.toHaveBeenCalled();
  });

  // ── --force ────────────────────────────────────────────────────────────────

  it("invokes the AI with --force even when there is no new message", async () => {
    mockGetIssueConversation.mockReturnValue(conversationWithoutNewMessage());

    await run("34", "--with", "claude", "--force");

    expect(mockInvokeClaudeCode).toHaveBeenCalledOnce();
    expect(out.stdout).toContain("forced run");
    const [, body] = mockPostComment.mock.calls[0] as [number, string];
    expect(body).toContain("forced run");
  });

  it("still filters the conversation when --force is used", async () => {
    await run("34", "--with", "claude", "--force");

    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).not.toContain("please also do my thing");
  });

  // ── Configuration validation ───────────────────────────────────────────────

  it("exits 1 when no allowed users are configured", async () => {
    mockReadConfig.mockReturnValue({ agentUser: "agent-bot" });

    await expect(run("34", "--with", "claude")).rejects.toThrow("process.exit(1)");
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("No allowed users configured");
    expect(mockGetIssueConversation).not.toHaveBeenCalled();
  });

  it("exits 1 when the allowed-user list is empty", async () => {
    mockReadConfig.mockReturnValue({ allowedUsers: ["  "], agentUser: "agent-bot" });

    await expect(run("34", "--with", "claude")).rejects.toThrow("process.exit(1)");
    expect(out.stderr).toContain("No allowed users configured");
  });

  it("exits 1 when no agent user is configured", async () => {
    mockReadConfig.mockReturnValue({ allowedUsers: ["alice"] });

    await expect(run("34", "--with", "claude")).rejects.toThrow("process.exit(1)");
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("No agent user configured");
    expect(mockGetIssueConversation).not.toHaveBeenCalled();
  });

  it("exits 1 for an Azure DevOps remote", async () => {
    mockReadConfig.mockReturnValue({ ...CONFIG, remoteType: "azdo" });

    await expect(run("34", "--with", "claude")).rejects.toThrow("process.exit(1)");
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("docs/azdo-gap.md");
  });

  it("works when remoteType is absent", async () => {
    await run("34", "--with", "claude");

    expect(mockInvokeClaudeCode).toHaveBeenCalledOnce();
  });

  it("exits 1 for a non-numeric issue number", async () => {
    await expect(run("abc", "--with", "claude")).rejects.toThrow("process.exit(1)");
    expect(out.stderr).toContain("must be a positive integer");
  });

  it("exits 1 for a zero or negative issue number", async () => {
    await expect(run("0", "--with", "claude")).rejects.toThrow("process.exit(1)");
    expect(out.stderr).toContain("must be a positive integer");
  });

  it("exits 1 for an invalid executor", async () => {
    await expect(run("34", "--with", "gemini")).rejects.toThrow("process.exit(1)");
    expect(out.stderr).toContain("--with must be 'claude' or 'codex'");
  });

  // ── Failure handling ───────────────────────────────────────────────────────

  it("exits 1 and skips the AI when the issue cannot be read", async () => {
    mockGetIssueConversation.mockImplementation(() => {
      throw new Error("could not resolve to an Issue");
    });

    await expect(run("34", "--with", "claude")).rejects.toThrow("process.exit(1)");
    expect(out.stderr).toContain("could not resolve to an Issue");
    expect(mockInvokeClaudeCode).not.toHaveBeenCalled();
    expect(mockPostComment).not.toHaveBeenCalled();
  });

  it("exits 1 and skips the AI when the marker comment cannot be posted", async () => {
    mockPostComment.mockImplementation(() => {
      throw new Error("gh: not authenticated");
    });

    await expect(run("34", "--with", "claude")).rejects.toThrow("process.exit(1)");
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("execution marker comment");
    expect(mockInvokeClaudeCode).not.toHaveBeenCalled();
  });

  // ── Executor options ───────────────────────────────────────────────────────

  it("invokes Codex when --with codex is passed", async () => {
    await run("34", "--with", "codex");

    expect(mockInvokeCodexCode).toHaveBeenCalledOnce();
    expect(mockInvokeClaudeCode).not.toHaveBeenCalled();
    const [, options] = mockInvokeCodexCode.mock.calls[0] as [string, { yolo?: boolean }];
    expect(options.yolo).toBe(true);
  });

  it("passes verbose:true to Claude by default and verbose:false with --silent", async () => {
    await run("34", "--with", "claude");
    const [, defaults] = mockInvokeClaudeCode.mock.calls[0] as [string, { verbose?: boolean; yolo?: boolean }];
    expect(defaults.verbose).toBe(true);
    expect(defaults.yolo).toBe(true);

    mockInvokeClaudeCode.mockClear();
    await run("34", "--with", "claude", "--silent");
    const [, silent] = mockInvokeClaudeCode.mock.calls[0] as [string, { verbose?: boolean }];
    expect(silent.verbose).toBe(false);
  });

  it("forwards --model to the selected executor", async () => {
    await run("34", "--with", "claude", "--model", "claude-sonnet-4-6");
    const [, claudeOptions] = mockInvokeClaudeCode.mock.calls[0] as [string, { model?: string }];
    expect(claudeOptions.model).toBe("claude-sonnet-4-6");

    await run("34", "--with", "codex", "--model", "o3");
    const [, codexOptions] = mockInvokeCodexCode.mock.calls[0] as [string, { model?: string }];
    expect(codexOptions.model).toBe("o3");
  });

  it("appends the commit-and-push instruction only with --push", async () => {
    await run("34", "--with", "claude");
    const [withoutPush] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(withoutPush).not.toContain("push the branch to the remote");

    mockInvokeClaudeCode.mockClear();
    await run("34", "--with", "claude", "--push");
    const [withPushPrompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(withPushPrompt).toContain("push the branch to the remote");
  });
});
