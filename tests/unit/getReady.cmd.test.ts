import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ORIG_CWD = process.cwd;
const TEST_CWD = join(ORIG_CWD(), "tmp-test-getready");

function makeIssues(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    number: i + 10,
    title: `Issue ${i + 1}`,
    body: `Body ${i + 1}.`,
    url: `https://github.com/o/r/issues/${i + 10}`,
  }));
}

// ── CLI smoke tests ───────────────────────────────────────────────────────────

describe("automata implement-next (CLI smoke)", () => {
  it("shows help for implement-next command", () => {
    const output = execSync(`"${process.execPath}" dist/index.js implement-next --help`, { encoding: "utf8" });
    expect(output).toContain("implement-next");
    expect(output).toContain("--json");
    expect(output).toContain("--no-claude");
    expect(output).toContain("--codex");
    expect(output).toContain("--query-only");
    expect(output).toContain("--yolo");
    expect(output).toContain("--take-first");
    expect(output).toContain("--limit");
  });

  it("is listed in the top-level help", () => {
    const output = execSync(`"${process.execPath}" dist/index.js --help`, { encoding: "utf8" });
    expect(output).toContain("implement-next");
  });
});

// ── Unit tests for getReady command logic ─────────────────────────────────────

const mockSpawnSync = vi.fn();
const mockReadlineQuestion = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  };
});

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_prompt: string, cb: (answer: string) => void) => {
      const answer = mockReadlineQuestion();
      cb(answer);
    },
    close: () => undefined,
  }),
}));

describe("getReady command: config validation", () => {
  beforeEach(() => {
    mkdirSync(TEST_CWD, { recursive: true });
    process.cwd = () => TEST_CWD;
    mockSpawnSync.mockReset();
    mockReadlineQuestion.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    process.cwd = ORIG_CWD;
    rmSync(TEST_CWD, { recursive: true, force: true });
  });

  it("exits 1 with error when remoteType is azdo", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "azdo" });

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    try {
      await implementNextCommand.parseAsync([], { from: "user" });
    } catch {
      // expected
    }

    expect(stderrLines.join("")).toContain("implement-next is not supported in Azure DevOps mode");
    expect(stderrLines.join("")).toContain("docs/azdo-gap.md");
    expect(exitSpy).toHaveBeenCalledWith(1);

    vi.restoreAllMocks();
  });

  it("exits 1 when no issueDiscoveryTechnique configured", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh" });

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    try {
      await implementNextCommand.parseAsync([], { from: "user" });
    } catch {
      // expected
    }

    expect(stderrLines.join("")).toContain("No issue discovery technique configured");
    expect(exitSpy).toHaveBeenCalledWith(1);

    vi.restoreAllMocks();
  });

  it("exits 1 when --limit is not a positive integer", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    try {
      await implementNextCommand.parseAsync(["--limit", "0"], { from: "user" });
    } catch {
      // expected
    }

    expect(stderrLines.join("")).toContain("--limit must be a positive integer");
    expect(exitSpy).toHaveBeenCalledWith(1);

    vi.restoreAllMocks();
  });

  it("exits 1 when --limit is non-numeric", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    try {
      await implementNextCommand.parseAsync(["--limit", "abc"], { from: "user" });
    } catch {
      // expected
    }

    expect(stderrLines.join("")).toContain("--limit must be a positive integer");
    expect(exitSpy).toHaveBeenCalledWith(1);

    vi.restoreAllMocks();
  });
});

describe("getReady command: Claude Code invocation", () => {
  beforeEach(() => {
    mkdirSync(TEST_CWD, { recursive: true });
    process.cwd = () => TEST_CWD;
    mockSpawnSync.mockReset();
    mockReadlineQuestion.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    process.cwd = ORIG_CWD;
    rmSync(TEST_CWD, { recursive: true, force: true });
  });

  it("invokes claude with system prompt prepended when configured", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({
      remoteType: "gh",
      issueDiscoveryTechnique: "label",
      issueDiscoveryValue: "ready",
      claudeSystemPrompt: "You are senior engineer.",
    });

    const issue = { number: 5, title: "Test issue", body: "Do the thing.", url: "https://github.com/o/r/issues/5" };

    // First call: gh issue list
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify([issue]), stderr: "", status: 0 });
    // Second call: gh issue comment
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    // Third call: claude
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0, stdio: "inherit" });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync([], { from: "user" });

    const claudeCall = mockSpawnSync.mock.calls.find((c) => String(c[0]).endsWith("claude"));
    expect(claudeCall).toBeDefined();
    const claudeArgs = claudeCall![1] as string[];
    expect(claudeArgs[0]).toBe("-p");
    expect(claudeArgs[1]).toContain("You are senior engineer.");
    expect(claudeArgs[1]).toContain("Do the thing.");

    vi.restoreAllMocks();
  });

  it("invokes claude with default system prompt when no system prompt configured", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({
      remoteType: "gh",
      issueDiscoveryTechnique: "label",
      issueDiscoveryValue: "ready",
    });

    const issue = { number: 3, title: "Another issue", body: "Fix this.", url: "https://github.com/o/r/issues/3" };

    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify([issue]), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync([], { from: "user" });

    const claudeCall = mockSpawnSync.mock.calls.find((c) => String(c[0]).endsWith("claude"));
    expect(claudeCall).toBeDefined();
    const claudeArgs = claudeCall![1] as string[];
    expect(claudeArgs[0]).toBe("-p");
    expect(claudeArgs[1]).toContain("You are an expert software engineer.");
    expect(claudeArgs[1]).toContain("Fix this.");

    vi.restoreAllMocks();
  });

  it("skips claude invocation when --no-claude flag is passed", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({
      remoteType: "gh",
      issueDiscoveryTechnique: "label",
      issueDiscoveryValue: "ready",
    });

    const issue = { number: 1, title: "Issue", body: "Body.", url: "https://github.com/o/r/issues/1" };

    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify([issue]), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync(["--no-claude"], { from: "user" });

    const claudeCall = mockSpawnSync.mock.calls.find((c) => String(c[0]).endsWith("claude"));
    expect(claudeCall).toBeUndefined();

    vi.restoreAllMocks();
  });

  it("invokes codex instead of claude when --codex flag is passed", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({
      remoteType: "gh",
      issueDiscoveryTechnique: "label",
      issueDiscoveryValue: "ready",
    });

    const issue = { number: 2, title: "Codex issue", body: "Do with codex.", url: "https://github.com/o/r/issues/2" };

    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify([issue]), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync(["--codex"], { from: "user" });

    const codexCall = mockSpawnSync.mock.calls.find((c) => String(c[0]).endsWith("codex"));
    expect(codexCall).toBeDefined();
    const codexArgs = codexCall![1] as string[];
    expect(codexArgs).toContain("exec");
    expect(codexArgs[codexArgs.length - 1]).toContain("You are an expert software engineer.");
    expect(codexArgs[codexArgs.length - 1]).toContain("Do with codex.");

    const claudeCall = mockSpawnSync.mock.calls.find((c) => String(c[0]).endsWith("claude"));
    expect(claudeCall).toBeUndefined();

    vi.restoreAllMocks();
  });

  it("single issue: prints issue ID and title before AI invocation", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issue = { number: 7, title: "Single issue title", body: "Body text.", url: "https://github.com/o/r/issues/7" };
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify([issue]), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    const stdoutLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((msg: unknown) => {
      stdoutLines.push(String(msg));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync([], { from: "user" });

    const combined = stdoutLines.join("");
    expect(combined).toContain("#7");
    expect(combined).toContain("Single issue title");

    vi.restoreAllMocks();
  });

  it("prompt includes issue number (Claude)", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issue = { number: 42, title: "Feature X", body: "Implement feature X.", url: "https://github.com/o/r/issues/42" };
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify([issue]), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync([], { from: "user" });

    const claudeCall = mockSpawnSync.mock.calls.find((c) => String(c[0]).endsWith("claude"));
    expect(claudeCall).toBeDefined();
    const prompt = (claudeCall![1] as string[])[1];
    expect(prompt).toContain("Resolving issue #42");

    vi.restoreAllMocks();
  });

  it("prompt includes issue number (Codex)", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issue = { number: 99, title: "Codex task", body: "Do codex thing.", url: "https://github.com/o/r/issues/99" };
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify([issue]), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync(["--codex"], { from: "user" });

    const codexCall = mockSpawnSync.mock.calls.find((c) => String(c[0]).endsWith("codex"));
    expect(codexCall).toBeDefined();
    const prompt = (codexCall![1] as string[]).at(-1)!;
    expect(prompt).toContain("Resolving issue #99");

    vi.restoreAllMocks();
  });
});

describe("getReady command: multi-issue selection", () => {
  beforeEach(() => {
    mkdirSync(TEST_CWD, { recursive: true });
    process.cwd = () => TEST_CWD;
    mockSpawnSync.mockReset();
    mockReadlineQuestion.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    process.cwd = ORIG_CWD;
    rmSync(TEST_CWD, { recursive: true, force: true });
  });

  it("--take-first: selects first issue without prompting when multiple match", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issues = makeIssues(3);
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(issues), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    const stdoutLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((msg: unknown) => {
      stdoutLines.push(String(msg));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync(["--take-first"], { from: "user" });

    // readline should NOT have been called
    expect(mockReadlineQuestion).not.toHaveBeenCalled();

    const combined = stdoutLines.join("");
    expect(combined).toContain("#10");
    expect(combined).toContain("Issue 1");

    vi.restoreAllMocks();
  });

  it("--take-first: prompt includes first issue number", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issues = makeIssues(3);
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(issues), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync(["--take-first"], { from: "user" });

    const claudeCall = mockSpawnSync.mock.calls.find((c) => String(c[0]).endsWith("claude"));
    expect(claudeCall).toBeDefined();
    const prompt = (claudeCall![1] as string[])[1];
    expect(prompt).toContain("Resolving issue #10");

    vi.restoreAllMocks();
  });

  it("interactive: presents numbered list and selects chosen issue", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issues = makeIssues(5);
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(issues), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    mockReadlineQuestion.mockReturnValue("2");

    const stdoutLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((msg: unknown) => {
      stdoutLines.push(String(msg));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync([], { from: "user" });

    const combined = stdoutLines.join("");
    // Numbered list should appear
    expect(combined).toContain("[1]");
    expect(combined).toContain("[2]");
    expect(combined).toContain("[5]");

    // Selected issue is #11 (issues[1].number = 10 + 1 = 11)
    const claudeCall = mockSpawnSync.mock.calls.find((c) => String(c[0]).endsWith("claude"));
    expect(claudeCall).toBeDefined();
    const prompt = (claudeCall![1] as string[])[1];
    expect(prompt).toContain("Resolving issue #11");

    vi.restoreAllMocks();
  });

  it("interactive: shows 'first N' message when issues.length equals limit", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issues = makeIssues(10); // exactly at default limit of 10
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(issues), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    mockReadlineQuestion.mockReturnValue("1");

    const stdoutLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((msg: unknown) => {
      stdoutLines.push(String(msg));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync([], { from: "user" });

    const combined = stdoutLines.join("");
    expect(combined).toContain("Showing first 10 matching issues");

    vi.restoreAllMocks();
  });

  it("--json with multiple issues: keeps stdout machine-parseable", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issues = makeIssues(3);
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(issues), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    mockReadlineQuestion.mockReturnValue("2");

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((msg: unknown) => {
      stdoutLines.push(String(msg));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync(["--json", "--no-claude"], { from: "user" });

    expect(JSON.parse(stdoutLines.join(""))).toMatchObject({
      number: 11,
      title: "Issue 2",
      body: "Body 2.",
      url: "https://github.com/o/r/issues/11",
    });
    expect(stderrLines.join("")).toContain("[1]");
    expect(stderrLines.join("")).toContain("Issue:  #11");

    vi.restoreAllMocks();
  });

  it("interactive: exits 1 on out-of-range selection", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issues = makeIssues(3);
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(issues), stderr: "", status: 0 });

    mockReadlineQuestion.mockReturnValue("5");

    const stderrLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    try {
      await implementNextCommand.parseAsync([], { from: "user" });
    } catch {
      // expected
    }

    expect(stderrLines.join("")).toContain("Invalid selection");
    expect(exitSpy).toHaveBeenCalledWith(1);

    vi.restoreAllMocks();
  });

  it("interactive: exits 1 on non-numeric selection", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issues = makeIssues(3);
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(issues), stderr: "", status: 0 });

    mockReadlineQuestion.mockReturnValue("foo");

    const stderrLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    try {
      await implementNextCommand.parseAsync([], { from: "user" });
    } catch {
      // expected
    }

    expect(stderrLines.join("")).toContain("Invalid selection");
    expect(exitSpy).toHaveBeenCalledWith(1);

    vi.restoreAllMocks();
  });

  it("--query-only with multiple issues: prints list and exits without prompting", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issues = makeIssues(3);
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(issues), stderr: "", status: 0 });

    const stdoutLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((msg: unknown) => {
      stdoutLines.push(String(msg));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    try {
      await implementNextCommand.parseAsync(["--query-only"], { from: "user" });
    } catch {
      // expected exit
    }

    expect(mockReadlineQuestion).not.toHaveBeenCalled();
    const combined = stdoutLines.join("");
    expect(combined).toContain("[1]");
    expect(combined).toContain("[3]");
    expect(exitSpy).toHaveBeenCalledWith(0);

    // gh issue comment should NOT have been called
    const commentCall = mockSpawnSync.mock.calls.find(
      (c) => String(c[0]) === "gh" && (c[1] as string[]).includes("comment")
    );
    expect(commentCall).toBeUndefined();

    vi.restoreAllMocks();
  });

  it("--limit: passes correct limit to gh issue list", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    writeConfig({ remoteType: "gh", issueDiscoveryTechnique: "label", issueDiscoveryValue: "ready" });

    const issues = makeIssues(1);
    mockSpawnSync.mockReturnValueOnce({ stdout: JSON.stringify(issues), stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { implementNextCommand } = await import("../../src/commands/getReady.js");
    await implementNextCommand.parseAsync(["--limit", "20"], { from: "user" });

    const ghCall = mockSpawnSync.mock.calls.find((c) => String(c[0]) === "gh");
    expect(ghCall).toBeDefined();
    const ghArgs = ghCall![1] as string[];
    const limitIdx = ghArgs.indexOf("--limit");
    expect(limitIdx).toBeGreaterThan(-1);
    expect(ghArgs[limitIdx + 1]).toBe("20");

    vi.restoreAllMocks();
  });
});
