import { describe, it, expect } from "vitest";
import {
  decideConductorReply,
  decideConversation,
  isWatchClosed,
  issueConversation,
  prConversation,
  type Conversation,
} from "../../src/conductor/replyDecision.js";
import type { RawMessage } from "../../src/github/conversation.js";
import type { IssueSurface, PrSurface } from "../../src/github/ghWorkService.js";

const p = { agentUser: "bot", allowedUsers: ["alice", "Bob"] };

function msg(author: string, at: string, kind: RawMessage["kind"] = "issue-comment"): RawMessage {
  return { kind, author, body: "x", createdAt: `2026-10-01T${at}Z` };
}

function convo(messages: RawMessage[], state: Conversation["state"] = "open"): Conversation {
  return { kind: "issue", number: 7, state, messages };
}

describe("decideConversation", () => {
  it("replies when the agent spoke last", () => {
    const d = decideConversation(convo([msg("alice", "10:00:00"), msg("bot", "10:05:00")]), p);
    expect(d).toMatchObject({ kind: "reply", agentMessageAt: "2026-10-01T10:05:00Z" });
  });

  it("skips when an allowed user answered after the agent", () => {
    const d = decideConversation(convo([msg("bot", "10:00:00"), msg("alice", "10:05:00")]), p);
    expect(d).toMatchObject({ kind: "skip", reason: "answered" });
  });

  it("matches logins case-insensitively", () => {
    const d = decideConversation(convo([msg("BOT", "10:00:00"), msg("bob", "10:05:00")]), p);
    expect(d).toMatchObject({ kind: "skip", reason: "answered" });
  });

  it("treats a second allowed user's answer as an answer", () => {
    const d = decideConversation(convo([msg("bot", "10:00:00"), msg("Bob", "10:01:00")]), p);
    expect(d.kind).toBe("skip");
  });

  it("ignores accounts that are neither allowed nor the agent", () => {
    const d = decideConversation(convo([msg("bot", "10:00:00"), msg("mallory", "10:05:00")]), p);
    expect(d.kind).toBe("reply");
  });

  it("replies when an earlier answer predates a newer agent message", () => {
    const d = decideConversation(
      convo([msg("bot", "10:00:00"), msg("alice", "10:05:00"), msg("bot", "10:10:00")]),
      p,
    );
    expect(d).toMatchObject({ kind: "reply", agentMessageAt: "2026-10-01T10:10:00Z" });
  });

  it("skips when the agent never wrote", () => {
    const d = decideConversation(convo([msg("alice", "10:00:00")]), p);
    expect(d).toMatchObject({ kind: "skip", reason: "no-agent-message" });
    expect(decideConversation(convo([]), p)).toMatchObject({ reason: "no-agent-message" });
  });

  it("skips a closed or merged item even with an unanswered agent message", () => {
    const d = decideConversation(convo([msg("bot", "10:00:00")], "closed"), p);
    expect(d).toMatchObject({ kind: "skip", reason: "closed" });
  });

  it("does not let an issue body written by an allowed user answer the agent", () => {
    const d = decideConversation(convo([msg("bot", "10:00:00"), msg("alice", "10:05:00", "issue-body")]), p);
    expect(d.kind).toBe("reply");
  });

  it("counts an agent-authored issue body as an unanswered message", () => {
    const d = decideConversation(convo([msg("bot", "10:00:00", "issue-body")]), p);
    expect(d.kind).toBe("reply");
  });

  it("does not count an answer in the same second", () => {
    const d = decideConversation(convo([msg("bot", "10:00:00"), msg("alice", "10:00:00")]), p);
    expect(d.kind).toBe("reply");
  });
});

describe("conversation adapters", () => {
  const issueSurface = (state: "OPEN" | "CLOSED", messages: RawMessage[]): IssueSurface =>
    ({ issue: { number: 3 }, state, assignees: [], labels: [], messages }) as unknown as IssueSurface;
  const prSurface = (state: "OPEN" | "CLOSED" | "MERGED", messages: RawMessage[], threads: RawMessage[][]): PrSurface =>
    ({
      pr: { number: 9, state },
      assignees: [],
      messages,
      threads: threads.map((comments) => ({ comments })),
    }) as unknown as PrSurface;

  it("maps an issue surface", () => {
    expect(issueConversation(issueSurface("CLOSED", []))).toMatchObject({ kind: "issue", number: 3, state: "closed" });
    expect(issueConversation(issueSurface("OPEN", []))).toMatchObject({ state: "open" });
  });

  it("maps merged and closed pull requests to closed", () => {
    expect(prConversation(prSurface("MERGED", [], [])).state).toBe("closed");
    expect(prConversation(prSurface("CLOSED", [], [])).state).toBe("closed");
    expect(prConversation(prSurface("OPEN", [], [])).state).toBe("open");
  });

  it("reads review-thread comments as part of the pull request", () => {
    const pr = prConversation(prSurface("OPEN", [msg("alice", "10:00:00", "pr-comment")], [[msg("bot", "10:05:00", "thread-comment")]]));
    expect(decideConversation(pr, p).kind).toBe("reply");
    const answered = prConversation(
      prSurface("OPEN", [msg("bot", "10:00:00", "pr-comment")], [[msg("alice", "10:05:00", "thread-comment")]]),
    );
    expect(decideConversation(answered, p).kind).toBe("skip");
  });
});

describe("decideConductorReply", () => {
  it("needs a reply when only the pull request is unanswered", () => {
    const issue = convo([msg("bot", "10:00:00"), msg("alice", "10:05:00")]);
    const pr: Conversation = { kind: "pr", number: 8, state: "open", messages: [msg("bot", "11:00:00", "pr-comment")] };
    const verdict = decideConductorReply([issue, pr], p);
    expect(verdict.needsReply).toBe(true);
    expect(verdict.decisions.map((d) => d.kind)).toEqual(["skip", "reply"]);
  });

  it("needs a reply when only the issue is unanswered", () => {
    const issue = convo([msg("bot", "10:00:00")]);
    const pr: Conversation = { kind: "pr", number: 8, state: "open", messages: [msg("alice", "11:00:00", "pr-comment")] };
    expect(decideConductorReply([issue, pr], p).needsReply).toBe(true);
  });

  it("needs no reply when every conversation is answered, closed or empty", () => {
    const verdict = decideConductorReply(
      [convo([msg("bot", "10:00:00"), msg("alice", "10:01:00")]), convo([msg("bot", "10:00:00")], "closed"), convo([])],
      p,
    );
    expect(verdict.needsReply).toBe(false);
    expect(decideConductorReply([], p)).toEqual({ needsReply: false, decisions: [] });
  });
});

describe("isWatchClosed", () => {
  it("is the rule the prune uses", () => {
    expect(isWatchClosed("closed")).toBe(true);
    expect(isWatchClosed("open")).toBe(false);
  });
});
