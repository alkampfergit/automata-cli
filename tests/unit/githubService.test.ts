import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
  };
});

describe("githubService.listIssues", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns empty array when no issues match", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "[]", stderr: "", status: 0 });
    const { listIssues } = await import("../../src/config/githubService.js");
    expect(listIssues("label", "my-label")).toEqual([]);
  });

  it("returns all issues when label technique matches", async () => {
    const issue = { number: 10, title: "Fix bug", body: "Some body", url: "https://github.com/o/r/issues/10" };
    mockSpawnSync.mockReturnValue({ stdout: JSON.stringify([issue]), stderr: "", status: 0 });
    const { listIssues } = await import("../../src/config/githubService.js");
    expect(listIssues("label", "ready")).toEqual([issue]);
  });

  it("returns all issues when assignee technique is used", async () => {
    const issue = { number: 7, title: "Implement feature", body: "Details", url: "https://github.com/o/r/issues/7" };
    mockSpawnSync.mockReturnValue({ stdout: JSON.stringify([issue]), stderr: "", status: 0 });
    const { listIssues } = await import("../../src/config/githubService.js");
    expect(listIssues("assignee", "octocat")).toEqual([issue]);
  });

  it("uses title-contains search syntax", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "[]", stderr: "", status: 0 });
    const { listIssues } = await import("../../src/config/githubService.js");
    listIssues("title-contains", "performance");
    const args: string[] = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toContain("--search");
    expect(args[args.indexOf("--search") + 1]).toBe("performance in:title");
  });

  it("throws when gh returns non-zero status", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "gh: not authenticated", status: 1 });
    const { listIssues } = await import("../../src/config/githubService.js");
    expect(() => listIssues("label", "x")).toThrow("gh: not authenticated");
  });

  it("throws with ENOENT when gh is not installed", async () => {
    const enoentError = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    mockSpawnSync.mockReturnValue({ error: enoentError, stdout: "", stderr: "", status: null });
    const { listIssues } = await import("../../src/config/githubService.js");
    expect(() => listIssues("label", "x")).toThrow("`gh` CLI is not installed or not on PATH.");
  });
});

describe("githubService.postComment", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("calls gh issue comment with correct arguments", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });
    const { postComment } = await import("../../src/config/githubService.js");
    postComment(42, "working");
    const args: string[] = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["issue", "comment", "42", "--body", "working"]);
  });

  it("throws when gh comment fails", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "HTTP 403: forbidden", status: 1 });
    const { postComment } = await import("../../src/config/githubService.js");
    expect(() => postComment(42, "working")).toThrow("HTTP 403: forbidden");
  });

  it("throws with ENOENT when gh is not installed", async () => {
    const enoentError = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    mockSpawnSync.mockReturnValue({ error: enoentError, stdout: "", stderr: "", status: null });
    const { postComment } = await import("../../src/config/githubService.js");
    expect(() => postComment(42, "working")).toThrow("`gh` CLI is not installed or not on PATH.");
  });
});
