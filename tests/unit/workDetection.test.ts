import { describe, it, expect } from "vitest";
import {
  decideOrphanPrWork,
  decideWork,
  selectLinkedPr,
  agentAnsweredAfter,
  skipDuplicateHeadBranches,
  type Decision,
  type IssueState,
  type OrphanPrState,
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
    const decision = decideWork(state({ issueSurface: issueSurface({ state: "CLOSED" }) }), P, { baseBranch: BASE });
    expect(decision).toMatchObject({ kind: "skip", reason: "issue-closed" });
  });

  it("runs a discuss turn on the base branch when there is no pull request and a new message", () => {
    const decision = decideWork(state(), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("issue-discuss");
    expect(decision.item.branch).toBe(BASE);
    expect(decision.item.pr).toBeNull();
    expect(decision.item.reason).toMatch(/1 new issue message, no open pull request/);
  });

  it("skips when there is no pull request and nothing new", () => {
    const decision = decideWork(state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
      }), P, { baseBranch: BASE });
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("runs a build turn on the head branch when the pull request has a new message", () => {
    const decision = decideWork(state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({ messages: [message("bob", "2026-01-07T00:00:00Z", "pr-comment")] }),
      }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-work");
    expect(decision.item.branch).toBe("feature/042-flag");
    expect(decision.item.pr?.number).toBe(57);
  });

  it("runs a build turn when the pull request has an actionable unresolved thread", () => {
    const decision = decideWork(state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({ threads: [thread()] }),
      }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-work");
    expect(decision.item.actionableThreads).toHaveLength(1);
    expect(decision.item.reason).toMatch(/1 unresolved review thread/);
  });

  it("runs a build turn when only the issue has a new message but a pull request is open", () => {
    const decision = decideWork(state({ linkedPrs: [pullRequest()], prSurface: prSurface() }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-work");
    expect(decision.item.reason).toMatch(/1 new issue message/);
  });

  it("skips when neither the issue nor the pull request has anything new", () => {
    const decision = decideWork(state({
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
      }), P, { baseBranch: BASE });
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("treats a merged pull request as no pull request, so the turn is a discussion", () => {
    const decision = decideWork(state({
        linkedPrs: [pullRequest({ state: "MERGED" })],
        prSurface: prSurface({ pr: pullRequest({ state: "MERGED" }) }),
      }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("issue-discuss");
    expect(decision.item.branch).toBe(BASE);
  });

  it("treats a closed pull request as no pull request", () => {
    const decision = decideWork(state({
        linkedPrs: [pullRequest({ state: "CLOSED" })],
        prSurface: prSurface({ pr: pullRequest({ state: "CLOSED" }) }),
      }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("issue-discuss");
  });
});

describe("decideWork — one turn for both surfaces", () => {
  it("produces exactly one build turn carrying both surfaces' new messages", () => {
    const decision = decideWork(state({
        linkedPrs: [pullRequest()],
        prSurface: prSurface({ messages: [message("bob", "2026-01-07T00:00:00Z", "pr-comment")] }),
      }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-work");
    expect(decision.item.issueAnalysis.hasNewMessage).toBe(true);
    expect(decision.item.prAnalysis?.hasNewMessage).toBe(true);
  });
});

describe("decideWork — actionable threads", () => {
  it("ignores an unresolved thread whose newest comment is the agent's own reply", () => {
    const decision = decideWork(state({
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
      }), P, { baseBranch: BASE });
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("ignores an unresolved thread opened by a bot reviewer", () => {
    const decision = decideWork(state({
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
      }), P, { baseBranch: BASE });
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("still acts on a maintainer's feedback when a bot comments after it", () => {
    // The authorization filter runs before "who spoke last": a bot commenting
    // later must not suppress the maintainer's request.
    const decision = decideWork(state({
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
      }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.actionableThreads).toHaveLength(1);
  });

  it("strips unauthorized comments from the threads it returns", () => {
    const decision = decideWork(state({
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
      }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    const [actionable] = decision.item.actionableThreads;
    expect(actionable.comments.map((c) => c.author)).toEqual(["alice"]);
    expect(JSON.stringify(decision.item.actionableThreads)).not.toContain("copilot");
  });

  it("still ignores a thread whose only participant comment is the agent's", () => {
    const decision = decideWork(state({
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
      }), P, { baseBranch: BASE });
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("ignores a resolved thread even with a new authorized comment", () => {
    const decision = decideWork(state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({ threads: [thread({ isResolved: true })] }),
      }), P, { baseBranch: BASE });
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
    const decision = decideWork(state({
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
      }), P, { baseBranch: BASE });
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("still treats an authorized message newer than the agent's thread reply as new", () => {
    const decision = decideWork(state({
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
      }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-work");
  });

  it("does not double count an authorized thread comment as a new pull request message", () => {
    const decision = decideWork(state({
        issueSurface: issueSurface({
          messages: [
            message("alice", "2026-01-01T00:00:00Z", "issue-body"),
            message("automata-bot", "2026-01-02T00:00:00Z"),
          ],
        }),
        linkedPrs: [pullRequest()],
        prSurface: prSurface({ threads: [thread()] }),
      }), P, { baseBranch: BASE });
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
    const decision = decideWork(state({ linkedPrs: [fork], prSurface: prSurface({ pr: fork }) }), P, { baseBranch: BASE });
    expect(decision).toMatchObject({ kind: "skip", reason: "unsafe-pr-branch" });
    if (decision.kind !== "skip") return;
    expect(decision.detail).toMatch(/comes from a fork/);
  });

  it("refuses a build turn whose head is the base branch", () => {
    // A GitFlow release pull request `develop -> main` carrying `Closes #42`
    // would otherwise be checked out and pushed to, breaking the promise never
    // to push to the base branch.
    const release = pullRequest({ headRefName: BASE, baseRefName: "main" });
    const decision = decideWork(state({ linkedPrs: [release], prSurface: prSurface({ pr: release }) }), P, { baseBranch: BASE });
    expect(decision).toMatchObject({ kind: "skip", reason: "unsafe-pr-branch" });
    if (decision.kind !== "skip") return;
    expect(decision.detail).toMatch(/protected branch \(develop\)/);
  });

  it("refuses a build turn whose head is the repository default branch", () => {
    // A back-merge `main -> develop` carrying `Closes #42` keeps the literal
    // promise — its head is not the base branch — while defeating the reason the
    // guard exists: the model would be told to push to `main`.
    const backMerge = pullRequest({ headRefName: "main", baseRefName: BASE });
    const decision = decideWork(state({ linkedPrs: [backMerge], prSurface: prSurface({ pr: backMerge }) }), P, { baseBranch: BASE, defaultBranch: "main" });
    expect(decision).toMatchObject({ kind: "skip", reason: "unsafe-pr-branch" });
    if (decision.kind !== "skip") return;
    expect(decision.detail).toMatch(/protected branch \(main\)/);
  });

  it("refuses a head listed in protectedBranches even when it is neither base nor default", () => {
    // GitFlow: default branch is `develop`, base is `develop`, and a back-merge
    // `main -> develop` carrying `Closes #42` has head `main` — in neither set.
    const backMerge = pullRequest({ headRefName: "main", baseRefName: BASE });
    const decision = decideWork(
      state({ linkedPrs: [backMerge], prSurface: prSurface({ pr: backMerge }) }),
      P,
      { baseBranch: BASE, defaultBranch: BASE, protectedBranches: ["main", "master"] },
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "unsafe-pr-branch" });
    if (decision.kind !== "skip") return;
    expect(decision.detail).toMatch(/protected branch \(main\)/);
  });

  it("still allows an ordinary feature branch when a default branch is known", () => {
    const decision = decideWork(state({ linkedPrs: [pullRequest()], prSurface: prSurface() }), P, { baseBranch: BASE, defaultBranch: "main" });
    expect(decision.kind).toBe("work");
  });
});

describe("decideWork — assignment and ambiguity", () => {
  it("needs assignment when the agent is not an assignee", () => {
    const decision = decideWork(state({ issueSurface: issueSurface({ assignees: ["alice"] }) }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.needsAssignment).toBe(true);
  });

  it("does not need assignment when the agent is already an assignee, matched case-insensitively", () => {
    const decision = decideWork(state({ issueSurface: issueSurface({ assignees: ["alice", "AUTOMATA-BOT"] }) }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.needsAssignment).toBe(false);
  });

  it("reports the other open pull requests when several close the issue", () => {
    const newest = pullRequest({ number: 58, updatedAt: "2026-01-09T00:00:00Z" });
    const decision = decideWork(state({
        linkedPrs: [pullRequest(), newest],
        prSurface: prSurface({ pr: newest }),
      }), P, { baseBranch: BASE });
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

describe("decideOrphanPrWork — the orphan pull-request decision table", () => {
  const ORPHAN_PR = pullRequest({ number: 61, headRefName: "dependabot/npm_and_yarn/lodash-4.17.21" });

  function orphan(overrides: Partial<PrSurface> = {}): OrphanPrState {
    return { prSurface: { pr: ORPHAN_PR, messages: [], threads: [], ...overrides } };
  }

  it("runs a pr-orphan turn on the head branch for a new authorized comment", () => {
    const decision = decideOrphanPrWork(
      orphan({ messages: [message("alice", "2026-01-08T00:00:00Z", "pr-comment")] }),
      P,
      { baseBranch: BASE },
    );
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.turn).toBe("pr-orphan");
    expect(decision.item.issue).toBeNull();
    expect(decision.item.pr?.number).toBe(61);
    expect(decision.item.branch).toBe("dependabot/npm_and_yarn/lodash-4.17.21");
    expect(decision.item.needsAssignment).toBe(false);
    expect(decision.item.ambiguousPrs).toEqual([]);
    expect(decision.item.issueAnalysis.messages).toEqual([]);
    expect(decision.item.reason).toMatch(/1 new pull request message on pull request #61 \(no linked issue\)/);
  });

  it("runs a pr-orphan turn for a non-empty authorized review body", () => {
    const decision = decideOrphanPrWork(
      orphan({ messages: [message("bob", "2026-01-08T00:00:00Z", "pr-review")] }),
      P,
      { baseBranch: BASE },
    );
    expect(decision.kind).toBe("work");
  });

  it("runs a pr-orphan turn for an unresolved authorized review thread", () => {
    const decision = decideOrphanPrWork(orphan({ threads: [thread()] }), P, { baseBranch: BASE });
    expect(decision.kind).toBe("work");
    if (decision.kind !== "work") return;
    expect(decision.item.actionableThreads).toHaveLength(1);
    expect(decision.item.reason).toMatch(/1 unresolved review thread/);
  });

  it("does nothing when the only messages are from an unauthorized account", () => {
    // A freshly opened Dependabot pull request: the author is not authorized, so
    // its body and its own comments never start a run.
    const decision = decideOrphanPrWork(
      orphan({ messages: [message("dependabot[bot]", "2026-01-08T00:00:00Z", "pr-comment")] }),
      P,
      { baseBranch: BASE },
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
    if (decision.kind !== "skip") return;
    expect(decision.issue).toBeNull();
    expect(decision.pr?.number).toBe(61);
    expect(decision.detail).toMatch(/no messages from authorized accounts on pull request #61/);
  });

  it("does nothing once the agent has answered", () => {
    const decision = decideOrphanPrWork(
      orphan({
        messages: [
          message("alice", "2026-01-08T00:00:00Z", "pr-comment"),
          message("automata-bot", "2026-01-09T00:00:00Z", "pr-comment"),
        ],
      }),
      P,
      { baseBranch: BASE },
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
    if (decision.kind !== "skip") return;
    expect(decision.detail).toMatch(/nothing new on pull request #61 since the agent's message at/);
  });

  it("treats an agent reply anywhere on the pull request as answering a thread", () => {
    const decision = decideOrphanPrWork(
      orphan({
        messages: [message("automata-bot", "2026-01-09T00:00:00Z", "pr-comment")],
        threads: [thread({ comments: [message("alice", "2026-01-08T00:00:00Z", "thread-comment")] })],
      }),
      P,
      { baseBranch: BASE },
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });

  it("refuses a pull request from a fork", () => {
    const decision = decideOrphanPrWork(
      {
        prSurface: {
          pr: { ...ORPHAN_PR, isCrossRepository: true },
          messages: [message("alice", "2026-01-08T00:00:00Z", "pr-comment")],
          threads: [],
        },
      },
      P,
      { baseBranch: BASE },
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "unsafe-pr-branch" });
    if (decision.kind !== "skip") return;
    expect(decision.issue).toBeNull();
    expect(decision.detail).toMatch(/comes from a fork/);
  });

  it("refuses a pull request whose head is a protected branch", () => {
    const decision = decideOrphanPrWork(
      {
        prSurface: {
          pr: { ...ORPHAN_PR, headRefName: "develop" },
          messages: [message("alice", "2026-01-08T00:00:00Z", "pr-comment")],
          threads: [],
        },
      },
      P,
      { baseBranch: BASE, defaultBranch: "main", protectedBranches: ["release"] },
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "unsafe-pr-branch" });
  });

  it("refuses the repository default branch and the configured protected branches too", () => {
    for (const head of ["main", "release"]) {
      const decision = decideOrphanPrWork(
        {
          prSurface: {
            pr: { ...ORPHAN_PR, headRefName: head },
            messages: [message("alice", "2026-01-08T00:00:00Z", "pr-comment")],
            threads: [],
          },
        },
        P,
        { baseBranch: BASE, defaultBranch: "main", protectedBranches: ["release"] },
      );
      expect(decision).toMatchObject({ kind: "skip", reason: "unsafe-pr-branch" });
    }
  });

  it("skips a merged or closed pull request before anything else", () => {
    for (const state of ["MERGED", "CLOSED"] as const) {
      const decision = decideOrphanPrWork(
        {
          prSurface: {
            pr: { ...ORPHAN_PR, state, isCrossRepository: true },
            messages: [message("alice", "2026-01-08T00:00:00Z", "pr-comment")],
            threads: [],
          },
        },
        P,
        { baseBranch: BASE },
      );
      expect(decision).toMatchObject({ kind: "skip", reason: "pr-closed" });
      if (decision.kind !== "skip") return;
      expect(decision.detail).toMatch(new RegExp(`is ${state.toLowerCase()}`));
    }
  });

  it("does not count the agent's own thread replies as new messages", () => {
    const decision = decideOrphanPrWork(
      orphan({
        threads: [
          thread({
            isResolved: true,
            comments: [message("automata-bot", "2026-01-09T00:00:00Z", "thread-comment")],
          }),
        ],
      }),
      P,
      { baseBranch: BASE },
    );
    expect(decision).toMatchObject({ kind: "skip", reason: "no-new-messages" });
  });
});

// GitHub allows several open pull requests from one head branch to different
// bases, so the two `do-work` passes — disjoint at pull-request granularity —
// are *not* disjoint at branch granularity. Two build turns on one checkout
// would have the second inherit whatever the first left behind.
describe("skipDuplicateHeadBranches — one build turn per head branch per tick", () => {
  function work(prNumber: number, branch: string, turn: "pr-work" | "pr-orphan"): Decision {
    const pr = pullRequest({ number: prNumber, headRefName: branch });
    return {
      kind: "work",
      item: {
        issue: turn === "pr-work" ? ISSUE : null,
        turn,
        pr,
        branch,
        needsAssignment: false,
        issueAnalysis: { messages: [], newMessages: [], newMessageCount: 0, hasNewMessage: false, lastAgentAt: null },
        prAnalysis: null,
        actionableThreads: [],
        reason: "reason",
        ambiguousPrs: [],
      },
    };
  }

  it("keeps the first build turn on a branch and skips the later one", () => {
    const kept = work(61, "fix/x", "pr-work");
    const [first, second] = skipDuplicateHeadBranches([kept, work(62, "fix/x", "pr-orphan")]);

    expect(first).toBe(kept);
    expect(second).toMatchObject({ kind: "skip", reason: "branch-busy" });
    if (second.kind !== "skip") return;
    expect(second.detail).toContain("fix/x");
    // The skip has to name the pull request that took the branch, or the plan
    // reads as an unexplained refusal.
    expect(second.detail).toContain("#61");
    expect(second.pr?.number).toBe(62);
  });

  it("skips a second orphan sharing a head with the first", () => {
    const decisions = skipDuplicateHeadBranches([
      work(70, "chore/bump", "pr-orphan"),
      work(71, "chore/bump", "pr-orphan"),
    ]);
    expect(decisions.map((d) => d.kind)).toEqual(["work", "skip"]);
  });

  it("leaves build turns on distinct branches alone", () => {
    const decisions = skipDuplicateHeadBranches([
      work(61, "fix/x", "pr-work"),
      work(62, "fix/y", "pr-orphan"),
    ]);
    expect(decisions.every((d) => d.kind === "work")).toBe(true);
  });

  // A discuss turn's `branch` is the base branch, which it reads and never
  // writes — every issue without a pull request shares it, and always has.
  it("never skips a discuss turn, however many share the base branch", () => {
    const discuss = (n: number): Decision => ({
      ...work(n, BASE, "pr-work"),
      item: { ...work(n, BASE, "pr-work").item, turn: "issue-discuss", pr: null },
    });
    const decisions = skipDuplicateHeadBranches([discuss(1), discuss(2), discuss(3)]);
    expect(decisions.every((d) => d.kind === "work")).toBe(true);
  });

  it("passes skips through untouched", () => {
    const skip: Decision = { kind: "skip", issue: ISSUE, pr: null, reason: "issue-closed", detail: "closed" };
    expect(skipDuplicateHeadBranches([skip])).toEqual([skip]);
  });
});
