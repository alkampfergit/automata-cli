import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockResolveCurrentBranchComments = vi.fn();
const mockReadConfig = vi.fn(() => ({}));
const mockInvokeClaudeCode = vi.fn();
const mockInvokeCodexCode = vi.fn();
const mockResolveModelOption = vi.fn(() => undefined);

vi.mock("../../src/git/gitService.js", () => ({
  resolveCurrentBranchComments: () => mockResolveCurrentBranchComments(),
}));

vi.mock("../../src/config/configStore.js", () => ({
  readConfig: () => mockReadConfig(),
  writeConfig: vi.fn(),
  DEFAULT_FIX_COMMENTS_PROMPT: "Default: address each review comment.",
}));

vi.mock("../../src/claude/claudeService.js", () => ({
  invokeClaudeCode: (...args: unknown[]) => mockInvokeClaudeCode(...args),
  resolveModelOption: (opts: unknown) => mockResolveModelOption(opts),
}));

vi.mock("../../src/codex/codexService.js", () => ({
  invokeCodexCode: (...args: unknown[]) => mockInvokeCodexCode(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const SAMPLE_COMMENTS = [
  { author: "alice", body: "Please rename this variable.", path: "src/foo.ts", line: 12, createdAt: "2026-01-01T00:00:00Z" },
  { author: "bob", body: "Extract this into a helper.", path: "src/bar.ts", line: 34, createdAt: "2026-01-02T00:00:00Z" },
];

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("execute-prompt fix-comments command", () => {
  let out: ReturnType<typeof captureStreams>;

  beforeEach(() => {
    mockResolveCurrentBranchComments.mockReset().mockReturnValue({
      ok: true,
      branch: "feature/my-branch",
      comments: SAMPLE_COMMENTS,
    });
    mockReadConfig.mockReset().mockReturnValue({});
    mockInvokeClaudeCode.mockReset();
    mockInvokeCodexCode.mockReset();
    mockResolveModelOption.mockReset().mockReturnValue(undefined);
    out = captureStreams();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("invokes Claude with default prompt and comment text when no custom prompt is configured", async () => {
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments"]);

    expect(mockInvokeClaudeCode).toHaveBeenCalledOnce();
    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).toContain("Default: address each review comment.");
    expect(prompt).toContain("Please rename this variable.");
    expect(prompt).toContain("Extract this into a helper.");
  });

  it("invokes Claude with custom prompt when configured", async () => {
    mockReadConfig.mockReturnValue({ prompts: { fixComments: "Custom: fix the comments." } });
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments"]);

    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).toContain("Custom: fix the comments.");
  });

  it("invokes Codex instead of Claude when --codex is passed", async () => {
    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments", "--codex"]);

    expect(mockInvokeCodexCode).toHaveBeenCalledOnce();
    expect(mockInvokeClaudeCode).not.toHaveBeenCalled();
    const [prompt] = mockInvokeCodexCode.mock.calls[0] as [string, unknown];
    expect(prompt).toContain("Please rename this variable.");
  });

  it("passes verbose flag to Claude invocation", async () => {
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments", "--verbose"]);

    const [, options] = mockInvokeClaudeCode.mock.calls[0] as [string, { verbose?: boolean }];
    expect(options.verbose).toBe(true);
  });

  it("always passes yolo:true to Claude invocation", async () => {
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments"]);

    const [, options] = mockInvokeClaudeCode.mock.calls[0] as [string, { yolo?: boolean }];
    expect(options.yolo).toBe(true);
  });

  it("always passes yolo:true to Codex invocation", async () => {
    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments", "--codex"]);

    const [, options] = mockInvokeCodexCode.mock.calls[0] as [string, { yolo?: boolean }];
    expect(options.yolo).toBe(true);
  });

  it("appends commit-and-push instruction to prompt when --push is passed", async () => {
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments", "--push"]);

    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).toContain("commit");
    expect(prompt).toContain("push");
  });

  it("does not append commit-and-push instruction when --push is not passed", async () => {
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments"]);

    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).not.toMatch(/commit.*and.*push|push.*the.*changes/i);
  });

  it("exits 1 when there are no open comments on the PR", async () => {
    mockResolveCurrentBranchComments.mockReturnValue({ ok: true, branch: "feature/my-branch", comments: [] });

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await expect(
      executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("No open review comments");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when get-pr-comments returns unsupported (AzDO)", async () => {
    mockResolveCurrentBranchComments.mockReturnValue({ ok: false, kind: "unsupported" });

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await expect(
      executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("not supported");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when no pull request is found for the branch", async () => {
    mockResolveCurrentBranchComments.mockReturnValue({ ok: false, kind: "no-pr", branch: "feature/my-branch" });

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await expect(
      executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("No pull request found");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when getCurrentBranch throws", async () => {
    mockResolveCurrentBranchComments.mockReturnValue({ ok: false, kind: "error", message: "not a git repository" });

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await expect(
      executePromptCommand.parseAsync(["node", "execute-prompt", "fix-comments"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("not a git repository");
    expect(out.exitCode).toBe(1);
  });
});
