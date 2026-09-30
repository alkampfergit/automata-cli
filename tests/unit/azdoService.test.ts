import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/azdo/${name}`, import.meta.url), "utf8");

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

  it("throws when azdo reports that the checks could not be retrieved", async () => {
    mockSpawnSync.mockReturnValue(
      makeOutput([{ id: 3, title: "PR", status: "active", url: "https://example.com", checksError: "all sources failed" }]),
    );
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    expect(() => getPrInfo()).toThrow("could not retrieve the checks of PR #3: all sources failed");
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
    expect(mockSpawnSync).toHaveBeenCalledWith("azdo", ["pr", "status", "--json", "--no-update-check"], expect.any(Object));
  });

  it("maps the checks reported by azdo pr status", async () => {
    mockSpawnSync.mockReturnValue({ stdout: fixture("pr-status.json"), stderr: "", status: 0 });
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    expect(getPrInfo()?.checks).toEqual([
      { name: "Policy/Build", status: "COMPLETED", conclusion: "SUCCESS", description: "ok", detailsUrl: "" },
      {
        name: "sonarcloud/quality gate",
        status: "COMPLETED",
        conclusion: "FAILURE",
        description: "Quality Gate failed",
        detailsUrl: "https://sonarcloud.io/dashboard?id=my_project&pullRequest=42",
      },
      { name: "deploy", status: "PENDING", conclusion: null, description: "", detailsUrl: "" },
      { name: "lint", status: "COMPLETED", conclusion: "FAILURE", description: "boom", detailsUrl: "" },
    ]);
  });

  it("finds the PR of another branch and maps its pipeline runs", async () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: fixture("pr-list.json"), stderr: "", status: 0 })
      .mockReturnValueOnce({ stdout: fixture("pipeline-runs.json"), stderr: "", status: 0 });
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    const pr = getPrInfo("feature/other");
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      1,
      "azdo",
      ["pr", "list", "--branch", "feature/other", "--status", "all", "--json", "--no-update-check"],
      expect.any(Object),
    );
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      2,
      "azdo",
      ["pipeline", "get-runs", "--pr", "7", "--json", "--no-update-check"],
      expect.any(Object),
    );
    expect(pr?.number).toBe(7);
    expect(pr?.state).toBe("MERGED");
    expect(pr?.checks.map((c) => [c.name, c.status, c.conclusion])).toEqual([
      ["Build 20260930.3", "PENDING", null],
      ["Build 20260930.2", "COMPLETED", "FAILURE"],
      ["Build 20260930.1", "COMPLETED", "SUCCESS"],
      ["Build 898", "COMPLETED", "FAILURE"],
    ]);
  });

  it("returns null when another branch has no PR", async () => {
    mockSpawnSync.mockReturnValue(makeOutput([]));
    const { getPrInfo } = await import("../../src/config/azdoService.js");
    expect(getPrInfo("feature/none")).toBeNull();
    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
  });
});

describe("azdoService.mapCheckState", () => {
  it.each([
    ["succeeded", "COMPLETED", "SUCCESS"],
    ["failed", "COMPLETED", "FAILURE"],
    ["rejected", "COMPLETED", "FAILURE"],
    ["error", "COMPLETED", "FAILURE"],
    ["notApplicable", "COMPLETED", "SKIPPED"],
    ["pending", "PENDING", null],
    ["running", "IN_PROGRESS", null],
    ["queued", "QUEUED", null],
    ["somethingNew", "PENDING", null],
  ])("maps %s", async (state, status, conclusion) => {
    const { mapCheckState } = await import("../../src/config/azdoService.js");
    expect(mapCheckState(state)).toEqual({ status, conclusion });
  });
});
