import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  };
});

describe("codexService.invokeCodexCode (sync mode)", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes codex exec with prompt by default", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    invokeCodexCode("hello world");

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["exec", "hello world"]);
  });

  it("invokes codex with --dangerously-bypass-approvals-and-sandbox when yolo is true", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    invokeCodexCode("hello world", { yolo: true });

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["exec", "--dangerously-bypass-approvals-and-sandbox", "hello world"]);
  });

  it("forwards --model to codex exec when model is specified", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    invokeCodexCode("hello world", { model: "o3" });

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["exec", "--model", "o3", "hello world"]);
  });

  it("forwards --model after --dangerously flag when both yolo and model are set", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    invokeCodexCode("hello world", { yolo: true, model: "o3" });

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["exec", "--dangerously-bypass-approvals-and-sandbox", "--model", "o3", "hello world"]);
  });

  it("exits 1 when codex binary is not found (ENOENT)", async () => {
    const enoentError = new Error("spawn codex ENOENT") as NodeJS.ErrnoException;
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

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    expect(() => invokeCodexCode("hello")).toThrow("exit");

    expect(stderrLines.join("")).toContain("not installed or not on PATH");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with codex's exit code on non-zero status", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 42 });

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    expect(() => invokeCodexCode("hello")).toThrow("exit");

    expect(stderrLines.join("")).toContain("exited with code 42");
    expect(exitSpy).toHaveBeenCalledWith(42);
  });
});

describe("codexService.invokeCodexCode (--verbose flag)", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a warning when --verbose is passed", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    invokeCodexCode("hello", { verbose: true });

    expect(stderrLines.join("")).toContain("--verbose");
  });

  it("still invokes codex normally after the warning", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    invokeCodexCode("hello", { verbose: true });

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["exec", "hello"]);
  });

  it("does not pass --json or any extra flag to codex when --verbose is set", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    invokeCodexCode("hello", { verbose: true });

    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).not.toContain("--json");
    expect(args).not.toContain("--verbose");
  });
});
