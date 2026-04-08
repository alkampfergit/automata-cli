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

  it("returns comment URL from stderr when present", async () => {
    mockSpawnSync.mockReturnValue({
      stdout: "",
      stderr: "https://github.com/owner/repo/issues/42#issuecomment-123456\n",
      status: 0,
    });
    const { postComment } = await import("../../src/config/githubService.js");
    const url = postComment(42, "working");
    expect(url).toBe("https://github.com/owner/repo/issues/42#issuecomment-123456");
  });

  it("returns undefined when stderr has no comment URL", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });
    const { postComment } = await import("../../src/config/githubService.js");
    const url = postComment(42, "working");
    expect(url).toBeUndefined();
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

describe("githubService.editComment", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("calls gh api with PATCH to edit the comment", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "{}", stderr: "", status: 0 });
    const { editComment } = await import("../../src/config/githubService.js");
    editComment("https://github.com/owner/repo/issues/42#issuecomment-123456", "updated body");
    const args: string[] = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual([
      "api", "repos/owner/repo/issues/comments/123456",
      "-X", "PATCH", "-f", "body=updated body",
    ]);
  });

  it("throws when comment URL cannot be parsed", async () => {
    const { editComment } = await import("../../src/config/githubService.js");
    expect(() => editComment("https://example.com/bad", "body")).toThrow("Cannot parse comment URL");
  });

  it("throws when gh api fails", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "HTTP 404", status: 1 });
    const { editComment } = await import("../../src/config/githubService.js");
    expect(() => editComment("https://github.com/o/r/issues/1#issuecomment-999", "x")).toThrow("HTTP 404");
  });
});

describe("githubService.getCurrentBranchPr", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns PR info when a PR exists", async () => {
    const pr = { number: 7, url: "https://github.com/o/r/pull/7", body: "PR body" };
    mockSpawnSync.mockReturnValue({ stdout: JSON.stringify(pr), stderr: "", status: 0 });
    const { getCurrentBranchPr } = await import("../../src/config/githubService.js");
    expect(getCurrentBranchPr("my-branch")).toEqual(pr);
  });

  it("returns null when no PR exists", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "no pull requests found for branch", status: 1 });
    const { getCurrentBranchPr } = await import("../../src/config/githubService.js");
    expect(getCurrentBranchPr("my-branch")).toBeNull();
  });

  it("throws on unexpected errors", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "network error", status: 1 });
    const { getCurrentBranchPr } = await import("../../src/config/githubService.js");
    expect(() => getCurrentBranchPr("my-branch")).toThrow("network error");
  });
});

describe("githubService.addClosesRefToPr", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("appends Closes #N to the PR body", async () => {
    // First call: gh pr view (read body)
    mockSpawnSync.mockReturnValueOnce({ stdout: "Existing body", stderr: "", status: 0 });
    // Second call: gh pr edit (write body)
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

    const { addClosesRefToPr } = await import("../../src/config/githubService.js");
    addClosesRefToPr(7, 42);

    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    const editArgs: string[] = mockSpawnSync.mock.calls[1][1] as string[];
    expect(editArgs).toContain("--body");
    const bodyIdx = editArgs.indexOf("--body");
    expect(editArgs[bodyIdx + 1]).toContain("Closes #42");
    expect(editArgs[bodyIdx + 1]).toContain("Existing body");
  });

  it("skips edit when Closes #N already present", async () => {
    mockSpawnSync.mockReturnValueOnce({ stdout: "Body with Closes #42 already", stderr: "", status: 0 });

    const { addClosesRefToPr } = await import("../../src/config/githubService.js");
    addClosesRefToPr(7, 42);

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
  });

  it("throws when reading PR body fails", async () => {
    mockSpawnSync.mockReturnValueOnce({ stdout: "", stderr: "error", status: 1 });

    const { addClosesRefToPr } = await import("../../src/config/githubService.js");
    expect(() => addClosesRefToPr(7, 42)).toThrow("Failed to read PR #7 body");
  });
});

describe("githubService.addCopilotReviewer", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("calls gh pr edit --add-reviewer @copilot", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "", status: 0 });
    const { addCopilotReviewer } = await import("../../src/config/githubService.js");
    addCopilotReviewer(7);
    const args: string[] = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).toEqual(["pr", "edit", "7", "--add-reviewer", "@copilot"]);
  });

  it("throws when gh pr edit fails", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "unknown reviewer", status: 1 });
    const { addCopilotReviewer } = await import("../../src/config/githubService.js");
    expect(() => addCopilotReviewer(7)).toThrow("unknown reviewer");
  });
});
