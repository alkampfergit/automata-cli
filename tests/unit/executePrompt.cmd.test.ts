import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetCurrentBranch = vi.fn(() => "feature/my-branch");
const mockGetPrInfo = vi.fn();
const mockReadConfig = vi.fn(() => ({}));
const mockInvokeClaudeCode = vi.fn();
const mockInvokeCodexCode = vi.fn();
const mockResolveModelOption = vi.fn(() => undefined);

vi.mock("../../src/git/gitService.js", () => ({
  getCurrentBranch: () => mockGetCurrentBranch(),
  getPrInfo: (...args: unknown[]) => mockGetPrInfo(...args),
}));

vi.mock("../../src/config/configStore.js", () => ({
  readConfig: () => mockReadConfig(),
  writeConfig: vi.fn(),
  DEFAULT_SONAR_PROMPT: "Default: fix sonar issues at the given URL.",
}));

vi.mock("../../src/claude/claudeService.js", () => ({
  invokeClaudeCode: (...args: unknown[]) => mockInvokeClaudeCode(...args),
  resolveModelOption: (opts: unknown) => mockResolveModelOption(opts),
}));

vi.mock("../../src/codex/codexService.js", () => ({
  invokeCodexCode: (...args: unknown[]) => mockInvokeCodexCode(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const SONAR_URL = "https://sonarcloud.io/summary/new_code?id=my_project&pullRequest=42";

const OPEN_PR_WITH_SONAR = {
  number: 42,
  title: "Feature",
  state: "OPEN",
  url: "https://github.com/org/repo/pull/42",
  checks: [],
  sonarcloudUrl: SONAR_URL,
  sonarNewIssues: 3,
};

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

describe("execute-prompt sonar command", () => {
  let out: ReturnType<typeof captureStreams>;

  beforeEach(() => {
    mockGetCurrentBranch.mockReset().mockReturnValue("feature/my-branch");
    mockGetPrInfo.mockReset();
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

  it("invokes Claude with default sonar prompt and URL when no custom prompt is configured", async () => {
    mockGetPrInfo.mockResolvedValueOnce(OPEN_PR_WITH_SONAR);
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "sonar"]);

    expect(mockInvokeClaudeCode).toHaveBeenCalledOnce();
    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).toContain("Default: fix sonar issues at the given URL.");
    expect(prompt).toContain(SONAR_URL);
  });

  it("invokes Claude with custom sonar prompt when configured", async () => {
    mockGetPrInfo.mockResolvedValueOnce(OPEN_PR_WITH_SONAR);
    mockReadConfig.mockReturnValue({ prompts: { sonar: "Custom: fix it." } });
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "sonar"]);

    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).toContain("Custom: fix it.");
    expect(prompt).toContain(SONAR_URL);
  });

  it("invokes Codex instead of Claude when --codex flag is passed", async () => {
    mockGetPrInfo.mockResolvedValueOnce(OPEN_PR_WITH_SONAR);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "sonar", "--codex"]);

    expect(mockInvokeCodexCode).toHaveBeenCalledOnce();
    expect(mockInvokeClaudeCode).not.toHaveBeenCalled();
    const [prompt] = mockInvokeCodexCode.mock.calls[0] as [string, unknown];
    expect(prompt).toContain(SONAR_URL);
  });

  it("passes verbose flag to Claude invocation", async () => {
    mockGetPrInfo.mockResolvedValueOnce(OPEN_PR_WITH_SONAR);
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "sonar", "--verbose"]);

    expect(mockInvokeClaudeCode).toHaveBeenCalledOnce();
    const [, options] = mockInvokeClaudeCode.mock.calls[0] as [string, { verbose?: boolean }];
    expect(options.verbose).toBe(true);
  });

  it("always passes yolo:true to Claude invocation", async () => {
    mockGetPrInfo.mockResolvedValueOnce(OPEN_PR_WITH_SONAR);
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "sonar"]);

    const [, options] = mockInvokeClaudeCode.mock.calls[0] as [string, { yolo?: boolean }];
    expect(options.yolo).toBe(true);
  });

  it("always passes yolo:true to Codex invocation", async () => {
    mockGetPrInfo.mockResolvedValueOnce(OPEN_PR_WITH_SONAR);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "sonar", "--codex"]);

    const [, options] = mockInvokeCodexCode.mock.calls[0] as [string, { yolo?: boolean }];
    expect(options.yolo).toBe(true);
  });

  it("appends commit-and-push instruction to prompt when --push is passed", async () => {
    mockGetPrInfo.mockResolvedValueOnce(OPEN_PR_WITH_SONAR);
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "sonar", "--push"]);

    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    expect(prompt).toContain("commit");
    expect(prompt).toContain("push");
  });

  it("does not append commit-and-push instruction when --push is not passed", async () => {
    mockGetPrInfo.mockResolvedValueOnce(OPEN_PR_WITH_SONAR);
    mockInvokeClaudeCode.mockResolvedValueOnce(undefined);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await executePromptCommand.parseAsync(["node", "execute-prompt", "sonar"]);

    const [prompt] = mockInvokeClaudeCode.mock.calls[0] as [string, unknown];
    // The base prompt text doesn't mention committing/pushing
    expect(prompt).not.toMatch(/commit.*and.*push|push.*the.*changes/i);
  });

  it("exits 1 with informative error when no SonarCloud URL is found on the PR", async () => {
    mockGetPrInfo.mockResolvedValueOnce({
      ...OPEN_PR_WITH_SONAR,
      sonarcloudUrl: undefined,
      sonarNewIssues: undefined,
    });

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await expect(
      executePromptCommand.parseAsync(["node", "execute-prompt", "sonar"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("No SonarCloud analysis found");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when no pull request is found for the current branch", async () => {
    mockGetPrInfo.mockResolvedValueOnce(null);

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await expect(
      executePromptCommand.parseAsync(["node", "execute-prompt", "sonar"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("No pull request found");
    expect(out.exitCode).toBe(1);
  });

  it("exits 1 when getCurrentBranch throws", async () => {
    mockGetCurrentBranch.mockImplementationOnce(() => {
      throw new Error("not a git repository");
    });

    const { executePromptCommand } = await import("../../src/commands/executePrompt.js");
    await expect(
      executePromptCommand.parseAsync(["node", "execute-prompt", "sonar"]),
    ).rejects.toThrow("process.exit(1)");

    expect(out.stderr).toContain("not a git repository");
    expect(out.exitCode).toBe(1);
  });
});
