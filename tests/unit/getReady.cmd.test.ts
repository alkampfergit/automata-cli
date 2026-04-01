import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const AUTOMATA_DIR = join(process.cwd(), ".automata");

afterEach(() => {
  rmSync(AUTOMATA_DIR, { recursive: true, force: true });
});

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
  });

  it("is listed in the top-level help", () => {
    const output = execSync(`"${process.execPath}" dist/index.js --help`, { encoding: "utf8" });
    expect(output).toContain("implement-next");
  });
});

// ── Unit tests for getReady command logic ─────────────────────────────────────

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  };
});

describe("getReady command: config validation", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    rmSync(AUTOMATA_DIR, { recursive: true, force: true });
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
});

describe("getReady command: Claude Code invocation", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    rmSync(AUTOMATA_DIR, { recursive: true, force: true });
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

  it("invokes claude with only issue body when no system prompt configured", async () => {
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
    expect(claudeArgs[1]).toBe("Fix this.");

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
    expect(codexArgs[codexArgs.length - 1]).toBe("Do with codex.");

    const claudeCall = mockSpawnSync.mock.calls.find((c) => String(c[0]).endsWith("claude"));
    expect(claudeCall).toBeUndefined();

    vi.restoreAllMocks();
  });
});
