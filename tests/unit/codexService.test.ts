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

describe("codexService.invokeCodexCode (sync mode)", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockSpawn.mockReset();
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

function createMockChildProcess(events: string[], exitCode: number): EventEmitter & { stdout: Readable } {
  const stdout = new Readable({ read() {} });
  const child = new EventEmitter() as EventEmitter & { stdout: Readable };
  child.stdout = stdout;

  setImmediate(() => {
    for (const line of events) {
      stdout.push(line + "\n");
    }
    stdout.push(null);
    child.emit("close", exitCode);
  });

  return child;
}

describe("codexService.invokeCodexCode (verbose mode)", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockSpawn.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses spawn with --json flag in verbose mode", async () => {
    const child = createMockChildProcess([], 0);
    mockSpawn.mockReturnValue(child);

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    await invokeCodexCode("hello", { verbose: true });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toEqual(["exec", "--json", "hello"]);
  });

  it("combines yolo and verbose flags", async () => {
    const child = createMockChildProcess([], 0);
    mockSpawn.mockReturnValue(child);

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    await invokeCodexCode("hello", { yolo: true, verbose: true });

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toEqual(["exec", "--dangerously-bypass-approvals-and-sandbox", "--json", "hello"]);
  });

  it("displays tool_call events as step progress", async () => {
    const events = [
      JSON.stringify({ type: "tool_call", name: "shell", input: { cmd: "ls -la" } }),
    ];
    const child = createMockChildProcess(events, 0);
    mockSpawn.mockReturnValue(child);

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    await invokeCodexCode("hello", { verbose: true });

    expect(stderrLines.join("")).toContain("[step 1]");
    expect(stderrLines.join("")).toContain("running: ls -la");
  });

  it("displays agent_message events as step progress", async () => {
    const events = [
      JSON.stringify({ type: "agent_message", content: "I will help you with that." }),
    ];
    const child = createMockChildProcess(events, 0);
    mockSpawn.mockReturnValue(child);

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
      return true;
    });

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    await invokeCodexCode("hello", { verbose: true });

    expect(stderrLines.join("")).toContain("[step 1]");
    expect(stderrLines.join("")).toContain("I will help you with that.");
  });

  it("displays result on session_complete event", async () => {
    const events = [
      JSON.stringify({ type: "session_complete", result: "Done successfully" }),
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

    const { invokeCodexCode } = await import("../../src/codex/codexService.js");
    await invokeCodexCode("hello", { verbose: true });

    expect(stderrLines.join("")).toContain("--- Result ---");
    expect(stdoutLines.join("")).toContain("Done successfully");
  });
});
