import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: (...args: unknown[]) => mockSpawnSync(...args) };
});

import { listWorkItems } from "../../src/remote/azdoWorkItems.js";

const item = (id: number, state = "Active", description: string | null = `d${id}`) => ({
  id, title: `t${id}`, description, url: `u${id}`, state, tags: [], assignedTo: null,
});
const ok = (items: unknown) => ({ stdout: JSON.stringify(items), stderr: "", status: 0 });

beforeEach(() => mockSpawnSync.mockReset());

describe("listWorkItems", () => {
  it("maps work items to the issue shape and a null description to empty", () => {
    mockSpawnSync.mockReturnValue(ok([item(1), item(2, "New", null)]));
    expect(listWorkItems("label", "ready")).toEqual([
      { number: 1, title: "t1", body: "d1", url: "u1" },
      { number: 2, title: "t2", body: "", url: "u2" },
    ]);
  });

  it("cuts the list to the limit after dropping closed states, in any case", () => {
    mockSpawnSync.mockReturnValue(ok([item(1, "closed"), item(2), item(3, "Removed"), item(4), item(5)]));
    expect(listWorkItems("label", "x", 2).map((i) => i.number)).toEqual([2, 4]);
  });

  it("asks for four times the limit, never fewer than 50", () => {
    mockSpawnSync.mockReturnValue(ok([]));
    listWorkItems("label", "x", 20);
    expect(mockSpawnSync.mock.calls[0][1]).toContain("80");
  });

  it("throws azdo's stderr, a missing-CLI message, and a parse message", () => {
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "denied", status: 1 });
    expect(() => listWorkItems("label", "x")).toThrow("denied");
    mockSpawnSync.mockReturnValueOnce({ error: Object.assign(new Error("x"), { code: "ENOENT" }) });
    expect(() => listWorkItems("label", "x")).toThrow(/not installed/);
    mockSpawnSync.mockReturnValueOnce({ stdout: "nope", stderr: "", status: 0 });
    expect(() => listWorkItems("label", "x")).toThrow(/parse/);
  });
});
