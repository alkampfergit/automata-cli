import { describe, it, expect } from "vitest";
import {
  decideWork,
  selectLinkedPr,
  agentAnsweredAfter,
  type IssueState,
} from "../../src/github/workDetection.js";
import type { Participants, RawMessage } from "../../src/github/conversation.js";
import type { IssueSurface, PrSurface, PullRequestRef, ReviewThread } from "../../src/github/ghWorkService.js";

const P: Participants = { allowedUsers: ["alice", "bob"], agentUser: "automata-bot" };
const BASE = "develop";
const ISSUE = { number: 42, title: "Add a flag", body: "please", url: "https://gh/i/42" };

function message(author: string, createdAt: string, kind: RawMessage["kind"] = "issue-comment"): RawMessage {
  return { kind, author, body: `${author}@${createdAt}`, createdAt };
}

function issueSurface(overrides: Partial<IssueSurface> = {}): IssueSurface {
  return {
    issue: ISSUE,
    state: "OPEN",
    assignees: [],
    messages: [message("alice", "2026-01-01T00:00:00Z", "issue-body")],
    ...overrides,
  };
}

function pullRequest(overrides: Partial<PullRequestRef> = {}): PullRequestRef {
  return {
    number: 57,
    url: "https://gh/pr/57",
    title: "Add a flag",
    headRefName: "feature/042-flag",
    baseRefName: "develop",
    isCrossRepository: false,
    state: "OPEN",
    isDraft: false,
    updatedAt: "2026-01-05T00:00:00Z",
    ...overrides,
  };
}

function prSurface(overrides: Partial<PrSurface> = {}): PrSurface {
  return { pr: pullRequest(), messages: [], threads: [], ...overrides };
}

function thread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    path: "src/index.ts",
    line: 12,
    isResolved: false,
    comments: [message("alice", "2026-01-06T00:00:00Z", "thread-comment")],
    ...overrides,
  };
}

function state(overrides: Partial<IssueState> = {}): IssueState {
  return { issueSurface: issueSurface(), linkedPrs: [], prSurface: null, ...overrides };
}

describe("decideWork — the decision table", () => {
  it("skips a closed issue", () => {
    const decision = decideWork(state({ issueSurface: issueSurface({ state: "CLOSED" }) }), P, BASE);
    expect(decision).toMatchObject({ kind: "skip", reason: "issue-closed" });
  });

  it("runs a discuss turn on the base branch when there is no pull request and a new message", () => {
    const decision = decideWork(state(), P, BASE);
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("issue-discuss");
    expect(decision.item.branch).toBe(BASE);
    expect(decision.item.pr).toBeNull();
    expect(decision.item.reason).toMatch(/1 new issue message, no open pull request/);
  });

  it("skips when there is no pull request and nothing new", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
      }),
      P,
      BASE,
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("runs a build turn on the head branch when the pull request has a new message", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({ messages: [message("bob", "2026-01-07T00:00:00Z", "pr-comment")] }),
      }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-work");
    expect(decision.item.branch).toBe("feature/042-flag");
    expect(decision.item.pr?.number).toBe(57);
  });

  it("runs a build turn when the pull request has an actionable unresolved thread", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({ threads: [thread()] }),
      }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-work");
    expect(decision.item.actionableThreads).toHaveLength(1);
    expect(decision.item.reason).toMatch(/1 unresolved review thread/);
  });

  it("runs a build turn when only the issue has a new message but a pull request is open", () => {
    const decision = decideWork(
      state({ linkedPrs: [pullRequest()], prSurface: prSurface() }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-work");
    expect(decision.item.reason).toMatch(/1 new issue message/);
  });

  it("skips when neither the issue nor the pull request has anything new", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({
          messages: [
            message("bob", "2026-01-03T00:00:00Z", "pr-comment"),
            message("automata-bot", "2026-01-04T00:00:00Z", "pr-comment"),
          ],
        }),
      }),
      P,
      BASE,
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("treats a merged pull request as no pull request, so the turn is a discussion", () => {
    const decision = decideWork(
      state({
        linkedPrs: [pullRequest({ state: "MERGED" })],
        prSurface: prSurface({ pr: pullRequest({ state: "MERGED" }) }),
      }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("issue-discuss");
    expect(decision.item.branch).toBe(BASE);
  });

  it("treats a closed pull request as no pull request", () => {
    const decision = decideWork(
      state({
        linkedPrs: [pullRequest({ state: "CLOSED" })],
        prSurface: prSurface({ pr: pullRequest({ state: "CLOSED" }) }),
      }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("issue-discuss");
  });
});

describe("decideWork — one turn for both surfaces", () => {
  it("produces exactly one build turn carrying both surfaces' new messages", () => {
    const decision = decideWork(
      state({
        linkedPrs: [pullRequest()],
        prSurface: prSurface({ messages: [message("bob", "2026-01-07T00:00:00Z", "pr-comment")] }),
      }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-work");
    expect(decision.item.issueAnalysis.hasNewMessage).toBe(true);
    expect(decision.item.prAnalysis?.hasNewMessage).toBe(true);
  });
});

describe("decideWork — actionable threads", () => {
  it("ignores an unresolved thread whose newest comment is the agent's own reply", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({
          threads: [
            thread({
              comments: [
                message("alice", "2026-01-06T00:00:00Z", "thread-comment"),
                message("automata-bot", "2026-01-07T00:00:00Z", "thread-comment"),
              ],
            }),
          ],
        }),
      }),
      P,
      BASE,
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("ignores an unresolved thread opened by a bot reviewer", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({
          threads: [thread({ comments: [message("copilot", "2026-01-06T00:00:00Z", "thread-comment")] })],
        }),
      }),
      P,
      BASE,
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("still acts on a maintainer's feedback when a bot comments after it", () => {
    // The authorization filter runs before "who spoke last": a bot commenting
    // later must not suppress the maintainer's request.
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({
          threads: [
            thread({
              comments: [
                message("alice", "2026-01-06T00:00:00Z", "thread-comment"),
                message("copilot", "2026-01-07T00:00:00Z", "thread-comment"),
              ],
            }),
          ],
        }),
      }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.actionableThreads).toHaveLength(1);
  });

  it("strips unauthorized comments from the threads it returns", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({
          threads: [
            thread({
              comments: [
                message("copilot", "2026-01-05T00:00:00Z", "thread-comment"),
                message("alice", "2026-01-06T00:00:00Z", "thread-comment"),
              ],
            }),
          ],
        }),
      }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    const [actionable] = decision.item.actionableThreads;
    expect(actionable.comments.map((c) => c.author)).toEqual(["alice"]);
    expect(JSON.stringify(decision.item.actionableThreads)).not.toContain("copilot");
  });

  it("still ignores a thread whose only participant comment is the agent's", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({
          threads: [
            thread({
              comments: [
                message("alice", "2026-01-05T00:00:00Z", "thread-comment"),
                message("automata-bot", "2026-01-06T00:00:00Z", "thread-comment"),
                message("copilot", "2026-01-07T00:00:00Z", "thread-comment"),
              ],
            }),
          ],
        }),
      }),
      P,
      BASE,
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("ignores a resolved thread even with a new authorized comment", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({ threads: [thread({ isResolved: true })] }),
      }),
      P,
      BASE,
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });
});

describe("decideWork — the pull request boundary", () => {
  it("counts the agent's reply inside a review thread as having answered the pull request", () => {
    // The answer check flattens thread comments in, so if the boundary did not,
    // the marker would be deleted while an older review body still read as new —
    // and the same message would start a build turn on every tick. The default
    // build prompt explicitly invites replying in the thread, so this is the
    // expected path, not a corner case.
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({
          messages: [message("alice", "2026-01-06T00:00:00Z", "pr-review")],
          threads: [
            thread({
              comments: [
                message("alice", "2026-01-06T00:00:00Z", "thread-comment"),
                message("automata-bot", "2026-01-07T00:00:00Z", "thread-comment"),
              ],
            }),
          ],
        }),
      }),
      P,
      BASE,
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("still treats an authorized message newer than the agent's thread reply as new", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({
          messages: [message("alice", "2026-01-08T00:00:00Z", "pr-comment")],
          threads: [
            thread({
              comments: [message("automata-bot", "2026-01-07T00:00:00Z", "thread-comment")],
            }),
          ],
        }),
      }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-work");
  });

  it("does not double count an authorized thread comment as a new pull request message", () => {
    const decision = decideWork(
      state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({ threads: [thread()] }),
      }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.prAnalysis?.newMessageCount).toBe(0);
    expect(decision.item.actionableThreads).toHaveLength(1);
  });
});

describe("decideWork — unsafe pull request branches", () => {
  it("refuses a build turn on a pull request from a fork", () => {
    // headRefName names a branch in the fork, but preparation fetches
    // origin/<headRefName> — a different branch, or none at all.
    const fork = pullRequest({ isCrossRepository: true });
    const decision = decideWork(
      state({ linkedPrs: [fork], prSurface: prSurface({ pr: fork }) }),
      P,
      BASE,
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "unsafe-pr-branch" });
    if (decision.kind !== "skip") return;
    expect(decision.detail).toMatch(/comes from a fork/);
  });

  it("refuses a build turn whose head is the base branch", () => {
    // A GitFlow release pull request `develop -> main` carrying `Closes #42`
    // would otherwise be checked out and pushed to, breaking the promise never
    // to push to the base branch.
    const release = pullRequest({ headRefName: BASE, baseRefName: "main" });
    const decision = decideWork(
      state({ linkedPrs: [release], prSurface: prSurface({ pr: release }) }),
      P,
      BASE,
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "unsafe-pr-branch" });
    if (decision.kind !== "skip") return;
    expect(decision.detail).toMatch(/base branch/);
  });
});

describe("decideWork — assignment and ambiguity", () => {
  it("needs assignment when the agent is not an assignee", () => {
    const decision = decideWork(state({ issueSurface: issueSurface({ assignees: ["alice"] }) }), P, BASE);
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.needsAssignment).toBe(true);
  });

  it("does not need assignment when the agent is already an assignee, matched case-insensitively", () => {
    const decision = decideWork(
      state({ issueSurface: issueSurface({ assignees: ["alice", "AUTOMATA-BOT"] }) }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.needsAssignment).toBe(false);
  });

  it("reports the other open pull requests when several close the issue", () => {
    const newest = pullRequest({ number: 58, updatedAt: "2026-01-09T00:00:00Z" });
    const decision = decideWork(
      state({
        linkedPrs: [pullRequest(), newest],
        prSurface: prSurface({ pr: newest }),
      }),
      P,
      BASE,
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.pr?.number).toBe(58);
    expect(decision.item.ambiguousPrs.map((pr) => pr.number)).toEqual([57]);
  });
});

describe("selectLinkedPr", () => {
  it("returns null when no pull request is open", () => {
    expect(selectLinkedPr([pullRequest({ state: "MERGED" })])).toBeNull();
    expect(selectLinkedPr([])).toBeNull();
  });

  it("returns the most recently updated open pull request", () => {
    const newest = pullRequest({ number: 58, updatedAt: "2026-02-01T00:00:00Z" });
    expect(selectLinkedPr([pullRequest(), newest, pullRequest({ number: 59, state: "CLOSED" })])?.number).toBe(58);
  });
});

describe("agentAnsweredAfter", () => {
  const marker = { commentId: "1", createdAt: "2026-01-10T00:00:00Z" };

  it("is true when the agent posted a message after the marker", () => {
    expect(
      agentAnsweredAfter([message("automata-bot", "2026-01-10T00:05:00Z")], "automata-bot", marker),
    ).toBe(true);
  });

  it("is false for the marker comment itself", () => {
    expect(agentAnsweredAfter([message("automata-bot", marker.createdAt)], "automata-bot", marker)).toBe(false);
  });

  it("is false when the agent's only message predates the marker", () => {
    expect(
      agentAnsweredAfter([message("automata-bot", "2026-01-09T00:00:00Z")], "automata-bot", marker),
    ).toBe(false);
  });

  it("is false when only an authorized human posted after the marker", () => {
    expect(agentAnsweredAfter([message("alice", "2026-01-11T00:00:00Z")], "automata-bot", marker)).toBe(false);
  });

  it("is true when the agent replied inside a review thread", () => {
    expect(
      agentAnsweredAfter(
        [message("automata-bot", "2026-01-10T00:05:00Z", "thread-comment")],
        "automata-bot",
        marker,
      ),
    ).toBe(true);
  });

  it("matches the agent login case-insensitively", () => {
    expect(
      agentAnsweredAfter([message("AUTOMATA-BOT", "2026-01-10T00:05:00Z")], "automata-bot", marker),
    ).toBe(true);
  });

  it("ignores the issue body, which cannot be an answer", () => {
    expect(
      agentAnsweredAfter([message("automata-bot", "2026-01-11T00:00:00Z", "issue-body")], "automata-bot", marker),
    ).toBe(false);
  });

  it("is false for an empty surface", () => {
    expect(agentAnsweredAfter([], "automata-bot", marker)).toBe(false);
  });
});
