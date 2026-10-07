import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: (...args: unknown[]) => mockSpawnSync(...args) };
});

import {
  azdoWriteService as svc,
  AZDO_MAX_ARGV_COMMENT_CHARS,
  AZDO_MAX_PR_DESCRIPTION_CHARS,
} from "../../src/remote/azdoWriteService.js";

const ok = (stdout = "") => ({ stdout, stderr: "", status: 0 });
const prs = (...p: unknown[]) => ok(JSON.stringify({ pullRequests: p }));
const calls = (): string[][] => mockSpawnSync.mock.calls.map((c) => c[1] as string[]);

beforeEach(() => mockSpawnSync.mockReset());

describe("getCurrentBranchPr", () => {
  it("maps the current branch PR with no assignees", () => {
    mockSpawnSync.mockReturnValue(prs({ id: 7, url: "u", description: "body" }));
    expect(svc.getCurrentBranchPr()).toEqual({ number: 7, url: "u", body: "body", assignees: [] });
    expect(calls()[0]).toEqual(["pr", "status", "--json", "--no-update-check"]);
  });

  it("looks a named branch up among active PRs and maps a null description to empty", () => {
    mockSpawnSync.mockReturnValue(prs({ id: 8, url: "u", description: null }));
    expect(svc.getCurrentBranchPr("feature/x")?.body).toBe("");
    expect(calls()[0]).toContain("feature/x");
  });

  it("returns null when there is no PR", () => {
    mockSpawnSync.mockReturnValue(prs());
    expect(svc.getCurrentBranchPr()).toBeNull();
  });
});

describe("updatePrDescription", () => {
  it("sends the body on stdin, never argv", () => {
    mockSpawnSync.mockReturnValue(ok());
    svc.updatePrDescription(7, "hello `$x` \"q\"");
    expect(calls()[0]).toEqual(["pr", "update", "--pr-number", "7", "--description-file", "-", "--no-update-check"]);
    expect(mockSpawnSync.mock.calls[0][2].input).toBe("hello `$x` \"q\"");
  });

  it("refuses a description over the Azure DevOps limit before calling azdo", () => {
    expect(() => svc.updatePrDescription(7, "x".repeat(AZDO_MAX_PR_DESCRIPTION_CHARS + 1))).toThrow(/limit of 4000/);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("throws azdo's stderr", () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "boom\n", status: 1 });
    expect(() => svc.updatePrDescription(7, "b")).toThrow("boom");
  });

  it("explains a missing azdo", () => {
    mockSpawnSync.mockReturnValue({ error: Object.assign(new Error("x"), { code: "ENOENT" }) });
    expect(() => svc.updatePrDescription(7, "b")).toThrow(/not installed/);
  });
});

describe("linkPrToIssue", () => {
  it("appends AB#N to the description and then links the work item", () => {
    mockSpawnSync
      .mockReturnValueOnce(prs({ id: 7, url: "u", description: "text\n" }))
      .mockReturnValueOnce(ok())
      .mockReturnValueOnce(ok());
    svc.linkPrToIssue(7, 42);
    expect(mockSpawnSync.mock.calls[1][2].input).toBe("text\n\nAB#42");
    expect(calls()[2]).toEqual(["pr", "work-items", "link", "42", "--pr-number", "7", "--no-update-check"]);
  });

  it("uses the bare reference for an empty description", () => {
    mockSpawnSync.mockReturnValueOnce(prs({ id: 7, url: "u", description: null })).mockReturnValue(ok());
    svc.linkPrToIssue(7, 42);
    expect(mockSpawnSync.mock.calls[1][2].input).toBe("AB#42");
  });

  it("does not rewrite a description that already references the item, but not AB#420 for 42", () => {
    mockSpawnSync.mockReturnValueOnce(prs({ id: 7, url: "u", description: "x AB#42." })).mockReturnValue(ok());
    svc.linkPrToIssue(7, 42);
    expect(calls().map((c) => c[1])).toEqual(["status", "work-items"]);

    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValueOnce(prs({ id: 7, url: "u", description: "AB#420" })).mockReturnValue(ok());
    svc.linkPrToIssue(7, 42);
    expect(calls().map((c) => c[1])).toEqual(["status", "update", "work-items"]);
  });

  it("falls back to the active PR list for a PR that is not the current branch's", () => {
    mockSpawnSync
      .mockReturnValueOnce(prs())
      .mockReturnValueOnce(prs({ id: 7, url: "u", description: "AB#42" }))
      .mockReturnValue(ok());
    svc.linkPrToIssue(7, 42);
    expect(calls()[1].slice(0, 2)).toEqual(["pr", "list"]);
  });

  it("fails when the PR is nowhere", () => {
    mockSpawnSync.mockReturnValue(prs());
    expect(() => svc.linkPrToIssue(7, 42)).toThrow(/not found/);
  });

  it("treats an already linked work item as success but surfaces other errors", () => {
    mockSpawnSync
      .mockReturnValueOnce(prs({ id: 7, url: "u", description: "AB#42" }))
      .mockReturnValueOnce({ stdout: "", stderr: "Work item is already linked", status: 1 });
    expect(() => svc.linkPrToIssue(7, 42)).not.toThrow();

    mockSpawnSync.mockReset();
    mockSpawnSync
      .mockReturnValueOnce(prs({ id: 7, url: "u", description: "AB#42" }))
      .mockReturnValueOnce({ stdout: "", stderr: "denied", status: 1 });
    expect(() => svc.linkPrToIssue(7, 42)).toThrow("denied");

    mockSpawnSync.mockReset();
    mockSpawnSync
      .mockReturnValueOnce(prs({ id: 7, url: "u", description: "AB#42" }))
      .mockReturnValueOnce({ stdout: "", stderr: "Build already completed", status: 1 });
    expect(() => svc.linkPrToIssue(7, 42)).toThrow("already completed");
  });
});

describe("requestReview", () => {
  it("adds the reviewer to the PR", () => {
    mockSpawnSync.mockReturnValue(ok());
    svc.requestReview(7, "bot@x.com");
    expect(calls()[0]).toEqual(["pr", "reviewers", "add", "bot@x.com", "--pr-number", "7", "--no-update-check"]);
  });

  it("requires a reviewer", () => {
    expect(() => svc.requestReview(7)).toThrow(/reviewer/);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });
});

describe("postIssueComment", () => {
  it("posts markdown and returns the url when reported", () => {
    mockSpawnSync.mockReturnValue(ok(JSON.stringify({ commentId: 3, url: "https://x/3" })));
    expect(svc.postIssueComment(42, "hi")).toBe("https://x/3");
    expect(calls()[0]).toEqual(["comments", "add", "42", "hi", "--markdown", "--json", "--no-update-check"]);
  });

  it("returns undefined without a url or with unparseable output", () => {
    mockSpawnSync.mockReturnValue(ok(JSON.stringify({ commentId: 3 })));
    expect(svc.postIssueComment(42, "hi")).toBeUndefined();
    mockSpawnSync.mockReturnValue(ok("nope"));
    expect(svc.postIssueComment(42, "hi")).toBeUndefined();
  });

  it("refuses an oversized body instead of truncating it", () => {
    expect(() => svc.postIssueComment(42, "x".repeat(AZDO_MAX_ARGV_COMMENT_CHARS + 1))).toThrow(/limited to/);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });
});

describe("postPrComment, assign", () => {
  it("posts the PR comment on stdin", () => {
    mockSpawnSync.mockReturnValue(ok());
    svc.postPrComment(7, "multi\nline");
    expect(calls()[0]).toEqual(["pr", "comment-add", "--pr-number", "7", "--file", "-", "--no-update-check"]);
    expect(mockSpawnSync.mock.calls[0][2].input).toBe("multi\nline");
  });

  it("assigns the work item", () => {
    mockSpawnSync.mockReturnValue(ok());
    svc.assignIssue(42, "Bot Name");
    expect(calls()[0]).toEqual(["assign", "42", "Bot Name", "--no-update-check"]);
  });

  it("claiming a PR is a no-op", () => {
    svc.assignPr();
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });
});
