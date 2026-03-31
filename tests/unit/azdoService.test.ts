import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  };
});

function makeOutput(pullRequests: unknown[]) {
  return {
    stdout: JSON.stringify({ pullRequests }),
    stderr: "",
    status: 0,
  };
}

describe("azdoService.getPrInfo", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns null when no pull requests exist", async () => {
    mockSpawnSync.mockReturnValue(makeOutput([]));
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    expect(getPrInfo()).toBeNull();
  });

  it("maps active status to OPEN", async () => {
    mockSpawnSync.mockReturnValue(
      makeOutput([{ id: 42, title: "My PR", status: "active", url: "https://dev.azure.com/o/p/_git/r/pullrequest/42" }]),
    );
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    const pr = getPrInfo();
    expect(pr).not.toBeNull();
    expect(pr?.state).toBe("OPEN");
    expect(pr?.number).toBe(42);
    expect(pr?.title).toBe("My PR");
    expect(pr?.url).toBe("https://dev.azure.com/o/p/_git/r/pullrequest/42");
    expect(pr?.checks).toEqual([]);
  });

  it("maps completed status to MERGED", async () => {
    mockSpawnSync.mockReturnValue(
      makeOutput([{ id: 10, title: "Done PR", status: "completed", url: "https://dev.azure.com/o/p/_git/r/pullrequest/10" }]),
    );
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    const pr = getPrInfo();
    expect(pr?.state).toBe("MERGED");
  });

  it("maps abandoned status to CLOSED", async () => {
    mockSpawnSync.mockReturnValue(
      makeOutput([{ id: 5, title: "Old PR", status: "abandoned", url: "https://dev.azure.com/o/p/_git/r/pullrequest/5" }]),
    );
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    const pr = getPrInfo();
    expect(pr?.state).toBe("CLOSED");
  });

  it("returns empty checks array", async () => {
    mockSpawnSync.mockReturnValue(
      makeOutput([{ id: 1, title: "PR", status: "active", url: "https://example.com" }]),
    );
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    const pr = getPrInfo();
    expect(pr?.checks).toEqual([]);
  });

  it("throws when azdo returns non-zero status", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "azdo: not authenticated", status: 1 });
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    expect(() => getPrInfo()).toThrow("azdo: not authenticated");
  });

  it("throws with ENOENT when azdo is not installed", async () => {
    const enoentError = Object.assign(new Error("spawn azdo ENOENT"), { code: "ENOENT" });
    mockSpawnSync.mockReturnValue({ error: enoentError, stdout: "", stderr: "", status: null });
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    expect(() => getPrInfo()).toThrow("`azdo` CLI is not installed or not on PATH.");
  });

  it("calls azdo pr status --json", async () => {
    mockSpawnSync.mockReturnValue(makeOutput([]));
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    getPrInfo();
    expect(mockSpawnSync).toHaveBeenCalledWith("azdo", ["pr", "status", "--json"], expect.any(Object));
  });
});
