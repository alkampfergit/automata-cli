import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: (...args: unknown[]) => mockSpawnSync(...args) };
});

function ok(stdout: string): { stdout: string; stderr: string; status: number } {
  return { stdout, stderr: "", status: 0 };
}

function json(value: unknown): { stdout: string; stderr: string; status: number } {
  return ok(JSON.stringify(value));
}

const REMOTE = ok("git@github.com:acme/widget.git\n");

function prNode(number: number, updatedAt: string, closes = 42, repo = "acme/widget") {
  return {
    number,
    url: `https://gh/pr/${String(number)}`,
    title: "t",
    headRefName: `feature/${String(number)}`,
    baseRefName: "develop",
    isCrossRepository: false,
    isDraft: false,
    updatedAt,
    closingIssuesReferences: {
      pageInfo: { hasNextPage: false },
      nodes: [{ number: closes, repository: { nameWithOwner: repo } }],
    },
  };
}

function calls(): { cmd: string; args: string[] }[] {
  return mockSpawnSync.mock.calls.map((call) => ({ cmd: call[0] as string, args: call[1] as string[] }));
}

beforeEach(() => {
  mockSpawnSync.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("getRepoSlug", () => {
  it("parses an ssh remote", async () => {
    mockSpawnSync.mockReturnValue(ok("git@github.com:acme/widget.git\n"));
    const { getRepoSlug } = await import("../../src/github/ghWorkService.js");
    expect(getRepoSlug()).toEqual({ owner: "acme", repo: "widget" });
  });

  it("parses an https remote without the .git suffix", async () => {
    mockSpawnSync.mockReturnValue(ok("https://github.com/acme/widget\n"));
    const { getRepoSlug } = await import("../../src/github/ghWorkService.js");
    expect(getRepoSlug()).toEqual({ owner: "acme", repo: "widget" });
  });

  it("throws for a non-GitHub remote", async () => {
    mockSpawnSync.mockReturnValue(ok("git@gitlab.com:acme/widget.git\n"));
    const { getRepoSlug } = await import("../../src/github/ghWorkService.js");
    expect(() => getRepoSlug()).toThrow(/Could not determine the GitHub owner\/repo/);
  });
});

describe("getAuthenticatedLogin", () => {
  it("returns the login gh reports", async () => {
    mockSpawnSync.mockReturnValue(ok("automata-bot\n"));
    const { getAuthenticatedLogin } = await import("../../src/github/ghWorkService.js");
    expect(getAuthenticatedLogin()).toBe("automata-bot");
    expect(calls()[0].args).toEqual(["api", "user", "--jq", ".login"]);
  });

  it("returns null when gh cannot answer, as with an app installation token", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "HTTP 403", status: 1 });
    const { getAuthenticatedLogin } = await import("../../src/github/ghWorkService.js");
    expect(getAuthenticatedLogin()).toBeNull();
  });

  it("returns null for empty output", async () => {
    mockSpawnSync.mockReturnValue(ok("  \n"));
    const { getAuthenticatedLogin } = await import("../../src/github/ghWorkService.js");
    expect(getAuthenticatedLogin()).toBeNull();
  });
});

describe("listCandidateIssues", () => {
  it("filters by label", async () => {
    mockSpawnSync.mockReturnValue(json([]));
    const { listCandidateIssues } = await import("../../src/github/ghWorkService.js");
    listCandidateIssues("label", "automated", 5);
    const args = calls()[0].args;
    expect(args).toContain("--label");
    expect(args).toContain("automated");
    expect(args).toContain("--limit");
    expect(args[args.indexOf("--limit") + 1]).toBe("5");
  });

  it("filters by title search", async () => {
    mockSpawnSync.mockReturnValue(json([]));
    const { listCandidateIssues } = await import("../../src/github/ghWorkService.js");
    listCandidateIssues("title-contains", "spike", 10);
    expect(calls()[0].args).toContain("spike in:title");
  });

  it("surfaces a gh failure", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "gh: not authenticated", status: 1 });
    const { listCandidateIssues } = await import("../../src/github/ghWorkService.js");
    expect(() => listCandidateIssues("label", "automated", 5)).toThrow(/not authenticated/);
  });

  it("reports a missing gh binary clearly", async () => {
    mockSpawnSync.mockReturnValue({ error: Object.assign(new Error("nope"), { code: "ENOENT" }) });
    const { listCandidateIssues } = await import("../../src/github/ghWorkService.js");
    expect(() => listCandidateIssues("label", "automated", 5)).toThrow(/`gh` CLI is not installed/);
  });
});

describe("getIssueSurface", () => {
  it("flattens authors and assignees and orders messages oldest first", async () => {
    mockSpawnSync.mockReturnValue(
      json({
        number: 42,
        title: "Add a flag",
        body: "please",
        url: "https://gh/i/42",
        state: "OPEN",
        author: { login: "alice" },
        createdAt: "2026-01-01T00:00:00Z",
        assignees: [{ login: "automata-bot" }, { login: "bob" }],
        comments: [
          { author: { login: "bob" }, body: "later", createdAt: "2026-01-03T00:00:00Z" },
          { author: { login: "alice" }, body: "earlier", createdAt: "2026-01-02T00:00:00Z" },
        ],
      }),
    );
    const { getIssueSurface } = await import("../../src/github/ghWorkService.js");
    const surface = getIssueSurface(42);
    expect(surface.issue).toEqual({ number: 42, title: "Add a flag", body: "please", url: "https://gh/i/42" });
    expect(surface.state).toBe("OPEN");
    expect(surface.assignees).toEqual(["automata-bot", "bob"]);
    expect(surface.messages.map((m) => [m.kind, m.author, m.createdAt])).toEqual([
      ["issue-body", "alice", "2026-01-01T00:00:00Z"],
      ["issue-comment", "alice", "2026-01-02T00:00:00Z"],
      ["issue-comment", "bob", "2026-01-03T00:00:00Z"],
    ]);
  });

  it("reports a closed issue and tolerates missing collections", async () => {
    mockSpawnSync.mockReturnValue(
      json({
        number: 7,
        title: "t",
        body: "b",
        url: "u",
        state: "CLOSED",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    );
    const { getIssueSurface } = await import("../../src/github/ghWorkService.js");
    const surface = getIssueSurface(7);
    expect(surface.state).toBe("CLOSED");
    expect(surface.assignees).toEqual([]);
    expect(surface.messages).toHaveLength(1);
    expect(surface.messages[0].author).toBe("");
  });
});

describe("getOpenPrLinkMap", () => {
  it("inverts pull requests into an issue-keyed map", async () => {
    mockSpawnSync.mockReturnValueOnce(REMOTE).mockReturnValueOnce(
      json({
        data: {
          repository: {
            defaultBranchRef: { name: "main" },
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                { ...prNode(57, "2026-01-05T00:00:00Z"), title: "Flag", headRefName: "feature/042" },
                {
                  ...prNode(58, "2026-01-06T00:00:00Z"),
                  title: "Unrelated",
                  headRefName: "feature/099",
                  isDraft: true,
                  closingIssuesReferences: { pageInfo: { hasNextPage: false }, nodes: [] },
                },
              ],
            },
          },
        },
      }),
    );
    const { getOpenPrLinkMap } = await import("../../src/github/ghWorkService.js");
    const map = getOpenPrLinkMap().byIssue;
    expect([...map.keys()]).toEqual([42]);
    expect(map.get(42)).toEqual([
      {
        number: 57,
        url: "https://gh/pr/57",
        title: "Flag",
        headRefName: "feature/042",
        baseRefName: "develop",
        isCrossRepository: false,
        state: "OPEN",
        isDraft: false,
        updatedAt: "2026-01-05T00:00:00Z",
      },
    ]);
  });

  it("keeps every pull request when two close the same issue", async () => {
    mockSpawnSync.mockReturnValueOnce(REMOTE).mockReturnValueOnce(
      json({
        data: {
          repository: {
            defaultBranchRef: { name: "main" },
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [prNode(57, "2026-01-05T00:00:00Z"), prNode(58, "2026-01-09T00:00:00Z")],
            },
          },
        },
      }),
    );
    const { getOpenPrLinkMap } = await import("../../src/github/ghWorkService.js");
    expect(getOpenPrLinkMap().byIssue.get(42)?.map((pr) => pr.number)).toEqual([57, 58]);
  });

  it("ignores a closing reference to an issue in another repository", async () => {
    // `Closes other-org/lib#42` would otherwise be indexed as this repository's
    // issue 42, linking an unrelated pull request to it.
    mockSpawnSync.mockReturnValueOnce(REMOTE).mockReturnValueOnce(
      json({
        data: {
          repository: {
            defaultBranchRef: { name: "main" },
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [prNode(57, "2026-01-05T00:00:00Z", 42, "other-org/lib")],
            },
          },
        },
      }),
    );
    const { getOpenPrLinkMap } = await import("../../src/github/ghWorkService.js");
    expect([...getOpenPrLinkMap().byIssue.keys()]).toEqual([]);
  });

  it("follows every page, because callers treat the map as authoritative", async () => {
    // A truncated map makes do-work start a competing implementation on an issue
    // that already has a pull request.
    mockSpawnSync
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(
        json({
          data: {
            repository: {
              pullRequests: {
                pageInfo: { hasNextPage: true, endCursor: "CURSOR1" },
                nodes: [prNode(57, "2026-01-05T00:00:00Z", 42)],
              },
            },
          },
        }),
      )
      .mockReturnValueOnce(
        json({
          data: {
            repository: {
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [prNode(58, "2026-01-06T00:00:00Z", 43)],
              },
            },
          },
        }),
      );
    const { getOpenPrLinkMap } = await import("../../src/github/ghWorkService.js");
    const map = getOpenPrLinkMap().byIssue;
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([42, 43]);
    // The cursor from the first page must be sent with the second request.
    expect(calls().some((c) => c.args.includes("cursor=CURSOR1"))).toBe(true);
  });

  it("fails closed when a PR closes more than 50 issues", async () => {
    // Callers treat absence from the map as proof that an issue has no pull
    // request, so a partial map is a wrong answer, not a degraded one.
    mockSpawnSync.mockReturnValueOnce(REMOTE).mockReturnValueOnce(
      json({
        data: {
          repository: {
            defaultBranchRef: { name: "main" },
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  ...prNode(57, "2026-01-05T00:00:00Z"),
                  closingIssuesReferences: { pageInfo: { hasNextPage: true }, nodes: [{ number: 42 }] },
                },
              ],
            },
          },
        },
      }),
    );
    const { getOpenPrLinkMap } = await import("../../src/github/ghWorkService.js");
    expect(() => getOpenPrLinkMap()).toThrow(/closes more than 50 issues/);
  });
});

describe("getReviewThreads pagination", () => {
  const prView = {
    number: 57,
    title: "Flag",
    url: "https://gh/pr/57",
    headRefName: "feature/042",
    state: "OPEN",
    isDraft: false,
    body: "Closes #42",
    author: { login: "automata-bot" },
    createdAt: "2026-01-04T00:00:00Z",
    updatedAt: "2026-01-08T00:00:00Z",
    comments: [],
    reviews: [],
  };

  function threadPage(path: string, hasNextPage: boolean, endCursor: string | null) {
    return json({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage, endCursor },
              nodes: [
                {
                  isResolved: false,
                  isOutdated: false,
                  path,
                  line: 1,
                  comments: { nodes: [{ author: { login: "alice" }, body: "x", createdAt: "2026-01-06T00:00:00Z" }] },
                },
              ],
            },
          },
        },
      },
    });
  }

  it("follows every page, so feedback past thread 100 is not invisible", async () => {
    mockSpawnSync
      .mockReturnValueOnce(json(prView))
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(threadPage("a.ts", true, "T1"))
      .mockReturnValueOnce(threadPage("b.ts", false, null));
    const { getPrSurface } = await import("../../src/github/ghWorkService.js");
    const surface = getPrSurface(57);
    expect(surface.threads.map((t) => t.path)).toEqual(["a.ts", "b.ts"]);
    expect(calls().some((c) => c.args.includes("cursor=T1"))).toBe(true);
  });

  it("requests pageInfo so truncation is detectable", async () => {
    mockSpawnSync
      .mockReturnValueOnce(json(prView))
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(threadPage("a.ts", false, null));
    const { getPrSurface } = await import("../../src/github/ghWorkService.js");
    getPrSurface(57);
    const query = calls()[2].args.find((arg) => arg.startsWith("query=")) ?? "";
    expect(query).toContain("pageInfo");
    expect(query).toContain("after:$cursor");
  });
});

describe("getPrSurface", () => {
  const prView = {
    number: 57,
    title: "Flag",
    url: "https://gh/pr/57",
    headRefName: "feature/042",
    state: "OPEN",
    isDraft: false,
    body: "Closes #42",
    author: { login: "automata-bot" },
    createdAt: "2026-01-04T00:00:00Z",
    updatedAt: "2026-01-08T00:00:00Z",
    comments: [{ author: { login: "alice" }, body: "please rename", createdAt: "2026-01-07T00:00:00Z" }],
    reviews: [
      { author: { login: "alice" }, body: "looks good overall", submittedAt: "2026-01-06T00:00:00Z" },
      { author: { login: "copilot" }, body: "   ", submittedAt: "2026-01-05T00:00:00Z" },
    ],
  };

  const threadsResponse = {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                isResolved: false,
                isOutdated: false,
                path: "src/index.ts",
                line: 12,
                comments: {
                  nodes: [
                    { author: { login: "automata-bot" }, body: "done", createdAt: "2026-01-07T00:00:00Z" },
                    { author: { login: "alice" }, body: "rename this", createdAt: "2026-01-06T00:00:00Z" },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };

  it("drops empty review bodies and orders messages oldest first", async () => {
    mockSpawnSync
      .mockReturnValueOnce(json(prView))
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(json(threadsResponse));
    const { getPrSurface } = await import("../../src/github/ghWorkService.js");
    const surface = getPrSurface(57);
    expect(surface.messages.map((m) => [m.kind, m.author, m.createdAt])).toEqual([
      ["pr-review", "alice", "2026-01-06T00:00:00Z"],
      ["pr-comment", "alice", "2026-01-07T00:00:00Z"],
    ]);
    expect(JSON.stringify(surface.messages)).not.toContain("copilot");
  });

  it("returns thread comments oldest first so the newest author can be read off the end", async () => {
    mockSpawnSync
      .mockReturnValueOnce(json(prView))
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(json(threadsResponse));
    const { getPrSurface } = await import("../../src/github/ghWorkService.js");
    const [thread] = getPrSurface(57).threads;
    expect(thread.comments.map((c) => c.author)).toEqual(["alice", "automata-bot"]);
    expect(thread.comments.every((c) => c.kind === "thread-comment")).toBe(true);
    expect(thread).toMatchObject({ path: "src/index.ts", line: 12, isResolved: false });
  });

  it("normalises the pull request state", async () => {
    mockSpawnSync
      .mockReturnValueOnce(json({ ...prView, state: "MERGED" }))
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(json(threadsResponse));
    const { getPrSurface } = await import("../../src/github/ghWorkService.js");
    expect(getPrSurface(57).pr.state).toBe("MERGED");
  });

  it("dates a review comment from when its review was submitted, not drafted", async () => {
    // GitHub stamps a pending review's comments as they are written. Using the
    // draft time let an answer posted mid-review look newer than the review, so
    // every thread in it was marked answered and the review was discarded.
    mockSpawnSync
      .mockReturnValueOnce(json(prView))
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(
        json({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      isResolved: false,
                      isOutdated: false,
                      path: "src/a.ts",
                      line: 1,
                      comments: {
                        pageInfo: { hasPreviousPage: false },
                        nodes: [
                          {
                            author: { login: "alice" },
                            body: "drafted early, submitted late",
                            createdAt: "2026-01-10T10:05:00Z",
                            pullRequestReview: { submittedAt: "2026-01-10T10:20:00Z" },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
      );
    const { getPrSurface } = await import("../../src/github/ghWorkService.js");
    const [thread] = getPrSurface(57).threads;
    expect(thread.comments[0].createdAt).toBe("2026-01-10T10:20:00Z");
  });

  it("keeps the draft time when the review has not been submitted", async () => {
    mockSpawnSync
      .mockReturnValueOnce(json(prView))
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(
        json({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      isResolved: false,
                      isOutdated: false,
                      path: "src/a.ts",
                      line: 1,
                      comments: {
                        pageInfo: { hasPreviousPage: false },
                        nodes: [
                          {
                            author: { login: "alice" },
                            body: "pending",
                            createdAt: "2026-01-10T10:05:00Z",
                            pullRequestReview: { submittedAt: null },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
      );
    const { getPrSurface } = await import("../../src/github/ghWorkService.js");
    expect(getPrSurface(57).threads[0].comments[0].createdAt).toBe("2026-01-10T10:05:00Z");
  });

  it("requests every comment in a thread, not just the first", async () => {
    mockSpawnSync
      .mockReturnValueOnce(json(prView))
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(json(threadsResponse));
    const { getPrSurface } = await import("../../src/github/ghWorkService.js");
    getPrSurface(57);
    const query = calls()[2].args.find((arg) => arg.startsWith("query=")) ?? "";
    // Only the newest comment can tell us whether the agent already replied.
    expect(query).toContain("comments(last:100)");
  });
});

describe("assignIssueToAgent", () => {
  it("adds the agent without removing existing assignees", async () => {
    mockSpawnSync.mockReturnValue(ok(""));
    const { assignIssueToAgent } = await import("../../src/github/ghWorkService.js");
    assignIssueToAgent(42, "automata-bot");
    expect(calls()[0].args).toEqual(["issue", "edit", "42", "--add-assignee", "automata-bot"]);
  });

  it("surfaces a failure", async () => {
    mockSpawnSync.mockReturnValue({ stdout: "", stderr: "HTTP 403: not a collaborator", status: 1 });
    const { assignIssueToAgent } = await import("../../src/github/ghWorkService.js");
    expect(() => assignIssueToAgent(42, "automata-bot")).toThrow(/not a collaborator/);
  });
});

describe("marker comments", () => {
  it("posts through the REST API and returns the id and creation time", async () => {
    mockSpawnSync
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(json({ id: 998877, created_at: "2026-01-10T00:00:00Z" }));
    const { postMarker } = await import("../../src/github/ghWorkService.js");
    expect(postMarker("issue", 42, "working…")).toEqual({
      commentId: "998877",
      createdAt: "2026-01-10T00:00:00Z",
    });
    expect(calls()[1].args).toEqual([
      "api",
      "--method",
      "POST",
      "repos/acme/widget/issues/42/comments",
      "-f",
      "body=working…",
    ]);
  });

  it("uses the same endpoint for a pull request, because a PR is an issue", async () => {
    mockSpawnSync
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce(json({ id: 1, created_at: "2026-01-10T00:00:00Z" }));
    const { postMarker } = await import("../../src/github/ghWorkService.js");
    postMarker("pr", 57, "working…");
    expect(calls()[1].args).toContain("repos/acme/widget/issues/57/comments");
  });

  it("updates a marker in place with PATCH", async () => {
    mockSpawnSync.mockReturnValueOnce(REMOTE).mockReturnValueOnce(ok(""));
    const { updateMarker } = await import("../../src/github/ghWorkService.js");
    updateMarker({ commentId: "998877", createdAt: "2026-01-10T00:00:00Z" }, "no answer produced");
    expect(calls()[1].args).toEqual([
      "api",
      "--method",
      "PATCH",
      "repos/acme/widget/issues/comments/998877",
      "-f",
      "body=no answer produced",
    ]);
  });

  it("deletes a marker with DELETE", async () => {
    mockSpawnSync.mockReturnValueOnce(REMOTE).mockReturnValueOnce(ok(""));
    const { deleteMarker } = await import("../../src/github/ghWorkService.js");
    deleteMarker({ commentId: "998877", createdAt: "2026-01-10T00:00:00Z" });
    expect(calls()[1].args).toEqual([
      "api",
      "--method",
      "DELETE",
      "repos/acme/widget/issues/comments/998877",
    ]);
  });

  it("treats an already-deleted marker as success", async () => {
    mockSpawnSync
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce({ stdout: "", stderr: "gh: Not Found (HTTP 404)", status: 1 });
    const { deleteMarker } = await import("../../src/github/ghWorkService.js");
    expect(() =>
      deleteMarker({ commentId: "998877", createdAt: "2026-01-10T00:00:00Z" }),
    ).not.toThrow();
  });

  it("surfaces a real delete failure", async () => {
    mockSpawnSync
      .mockReturnValueOnce(REMOTE)
      .mockReturnValueOnce({ stdout: "", stderr: "HTTP 403: forbidden", status: 1 });
    const { deleteMarker } = await import("../../src/github/ghWorkService.js");
    expect(() => deleteMarker({ commentId: "998877", createdAt: "2026-01-10T00:00:00Z" })).toThrow(
      /forbidden/,
    );
  });
});
