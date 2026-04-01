import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter, Readable } from "node:stream";

const mockSpawnSync = vi.fn();
const mockSpawn = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
    spawn: (...args: unknown[]) => mockSpawn(...args),
  };
});

describe("claudeService.invokeClaudeCode (sync mode)", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockSpawn.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes claude with -p and prompt by default", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    invokeClaudeCode("hello world");

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["-p", "hello world"]);
  });

  it("invokes claude with --dangerously-skip-permissions when yolo is true", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    invokeClaudeCode("hello world", { yolo: true });

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["--dangerously-skip-permissions", "-p", "hello world"]);
  });

  it("passes --model when model is specified", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    invokeClaudeCode("hello world", { model: "claude-opus-4-6" });

    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["--model", "claude-opus-4-6", "-p", "hello world"]);
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
    expect(() => invokeClaudeCode("hello")).toThrow("exit");

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
    expect(() => invokeClaudeCode("hello")).toThrow("exit");

    expect(stderrLines.join("")).toContain("exited with code 42");
    expect(exitSpy).toHaveBeenCalledWith(42);
  });
});

function createMockChildProcess(events: string[], exitCode: number): EventEmitter & { stdout: Readable } {
  const stdout = new Readable({ read() {} });
  const child = new EventEmitter() as EventEmitter & { stdout: Readable };
  child.stdout = stdout;

  // Push events async to simulate real streaming
  setImmediate(() => {
    for (const line of events) {
      stdout.push(line + "\n");
    }
    stdout.push(null); // end stream
    child.emit("close", exitCode);
  });

  return child;
}

describe("claudeService.invokeClaudeCode (verbose mode)", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockSpawn.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses spawn with --verbose --output-format stream-json", async () => {
    const child = createMockChildProcess([], 0);
    mockSpawn.mockReturnValue(child);

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    await invokeClaudeCode("hello", { verbose: true });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toEqual(["--verbose", "--output-format", "stream-json", "-p", "hello"]);
  });

  it("displays tool use steps from assistant events", async () => {
    const events = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/index.ts" } }] },
      }),
    ];
    const child = createMockChildProcess(events, 0);
    mockSpawn.mockReturnValue(child);

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    await invokeClaudeCode("hello", { verbose: true });

    expect(stderrLines.join("")).toContain("[step 1]");
    expect(stderrLines.join("")).toContain("reading src/index.ts");
  });

  it("displays result summary and outputs final text to stdout", async () => {
    const events = [
      JSON.stringify({
        type: "result",
        result: "The answer is 42",
        cost_usd: 0.0123,
        duration_ms: 5000,
        num_turns: 2,
      }),
    ];
    const child = createMockChildProcess(events, 0);
    mockSpawn.mockReturnValue(child);

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });
    const stdoutLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((msg: unknown) => {
      stdoutLines.push(String(msg));
      return true;
    });

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    await invokeClaudeCode("hello", { verbose: true });

    expect(stderrLines.join("")).toContain("--- Result ---");
    expect(stderrLines.join("")).toContain("2 turns");
    expect(stderrLines.join("")).toContain("5.0s");
    expect(stderrLines.join("")).toContain("$0.0123");
    expect(stdoutLines.join("")).toContain("The answer is 42");
  });

  it("combines yolo and verbose flags", async () => {
    const child = createMockChildProcess([], 0);
    mockSpawn.mockReturnValue(child);

    const { invokeClaudeCode } = await import("../../src/claude/claudeService.js");
    await invokeClaudeCode("hello", { yolo: true, verbose: true });

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toEqual(["--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json", "-p", "hello"]);
  });
});
