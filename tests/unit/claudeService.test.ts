import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  };
});

describe("claudeService.invokeClaudeCode", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes claude with -p and prompt when yolo is false", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    invokeClaudeCode("hello world", false);

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["-p", "hello world"]);
  });

  it("invokes claude with --dangerously-skip-permissions when yolo is true", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    invokeClaudeCode("hello world", true);

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["--dangerously-skip-permissions", "-p", "hello world"]);
  });

  it("exits 1 when claude binary is not found (ENOENT)", async () => {
    const enoentError = new Error("spawn claude ENOENT") as NodeJS.ErrnoException;
    enoentError.code = "ENOENT";
    mockSpawnSync.mockReturnValue({ error: enoentError, stdout: "", stderr: "", status: null });

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    expect(() => invokeClaudeCode("hello", false)).toThrow("exit");

    expect(stderrLines.join("")).toContain("not installed or not on PATH");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with claude's exit code on non-zero status", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 42 });

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    expect(() => invokeClaudeCode("hello", false)).toThrow("exit");

    expect(stderrLines.join("")).toContain("exited with code 42");
    expect(exitSpy).toHaveBeenCalledWith(42);
  });
});
