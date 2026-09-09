import { describe, it, expect } from "vitest";
import { analyzeConversation, formatConversation } from "../../src/github/issueConversation.js";
import type { IssueConversation } from "../../src/config/githubService.js";

function conversation(overrides: Partial<IssueConversation> = {}): IssueConversation {
  return {
    number: 34,
    title: "Check new messages in gh",
    body: "Please add the check-issue command.",
    url: "https://github.com/o/r/issues/34",
    author: "alice",
    createdAt: "2026-09-09T05:00:00Z",
    comments: [],
    ...overrides,
  };
}

function comment(author: string, body: string, createdAt: string) {
  return { id: `IC_${createdAt}`, author, body, createdAt };
}

const ALLOWED = ["alice", "bob"];
const AGENT = "agent-bot";

describe("analyzeConversation — new message detection", () => {
  it("uses the newest agent comment as the boundary", () => {
    const result = analyzeConversation(
      conversation({
        comments: [
          comment("alice", "first request", "2026-09-09T06:00:00Z"),
          comment(AGENT, "working", "2026-09-09T07:00:00Z"),
          comment("bob", "one more thing", "2026-09-09T08:00:00Z"),
        ],
      }),
      ALLOWED,
      AGENT,
    );

    expect(result.lastAgentAt).toBe("2026-09-09T07:00:00Z");
    expect(result.hasNewMessage).toBe(true);
    expect(result.newMessageCount).toBe(1);
    expect(result.messages.filter((m) => m.isNew).map((m) => m.body)).toEqual(["one more thing"]);
  });

  it("reports no new message when the agent commented last", () => {
    const result = analyzeConversation(
      conversation({
        comments: [
          comment("alice", "please fix", "2026-09-09T06:00:00Z"),
          comment(AGENT, "done", "2026-09-09T07:00:00Z"),
        ],
      }),
      ALLOWED,
      AGENT,
    );

    expect(result.hasNewMessage).toBe(false);
    expect(result.newMessageCount).toBe(0);
  });

  it("counts every allowed message newer than the boundary", () => {
    const result = analyzeConversation(
      conversation({
        comments: [
          comment(AGENT, "working", "2026-09-09T07:00:00Z"),
          comment("alice", "also this", "2026-09-09T08:00:00Z"),
          comment("bob", "and this", "2026-09-09T09:00:00Z"),
        ],
      }),
      ALLOWED,
      AGENT,
    );

    expect(result.newMessageCount).toBe(2);
  });

  it("treats an issue opened by an allowed user as new when the agent never commented", () => {
    const result = analyzeConversation(conversation(), ALLOWED, AGENT);

    expect(result.lastAgentAt).toBeNull();
    expect(result.hasNewMessage).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].kind).toBe("issue");
    expect(result.messages[0].isNew).toBe(true);
  });

  it("reports no new message for an issue opened by a non-allowed user with no comments", () => {
    const result = analyzeConversation(conversation({ author: "stranger" }), ALLOWED, AGENT);

    expect(result.hasNewMessage).toBe(false);
    expect(result.messages).toHaveLength(0);
  });

  it("does not use the issue description as the boundary when the agent opened the issue", () => {
    const result = analyzeConversation(
      conversation({
        author: AGENT,
        createdAt: "2026-09-09T05:00:00Z",
        comments: [comment("alice", "please do this", "2026-09-09T06:00:00Z")],
      }),
      ALLOWED,
      AGENT,
    );

    expect(result.lastAgentAt).toBeNull();
    expect(result.hasNewMessage).toBe(true);
    expect(result.newMessageCount).toBe(1);
  });

  it("never counts agent comments as new, even when the agent is also allowed", () => {
    const result = analyzeConversation(
      conversation({
        author: AGENT,
        comments: [comment(AGENT, "working", "2026-09-09T07:00:00Z")],
      }),
      [...ALLOWED, AGENT],
      AGENT,
    );

    expect(result.hasNewMessage).toBe(false);
    expect(result.newMessageCount).toBe(0);
  });

  it("ignores messages from users who are neither allowed nor the agent", () => {
    const result = analyzeConversation(
      conversation({
        comments: [
          comment(AGENT, "working", "2026-09-09T07:00:00Z"),
          comment("stranger", "me too please", "2026-09-09T08:00:00Z"),
        ],
      }),
      ALLOWED,
      AGENT,
    );

    expect(result.hasNewMessage).toBe(false);
    expect(result.messages.map((m) => m.author)).toEqual(["alice", AGENT]);
  });

  it("matches allowed and agent logins case-insensitively", () => {
    const result = analyzeConversation(
      conversation({
        author: "Alice",
        comments: [
          comment("Agent-Bot", "working", "2026-09-09T07:00:00Z"),
          comment("BOB", "one more thing", "2026-09-09T08:00:00Z"),
        ],
      }),
      ["alice", "bob"],
      "agent-bot",
    );

    expect(result.lastAgentAt).toBe("2026-09-09T07:00:00Z");
    expect(result.newMessageCount).toBe(1);
    expect(result.messages).toHaveLength(3);
  });

  it("treats a timestamp equal to the boundary as not new", () => {
    const result = analyzeConversation(
      conversation({
        comments: [
          comment(AGENT, "working", "2026-09-09T07:00:00Z"),
          comment("alice", "same instant", "2026-09-09T07:00:00Z"),
        ],
      }),
      ALLOWED,
      AGENT,
    );

    expect(result.hasNewMessage).toBe(false);
  });

  it("returns messages in chronological order regardless of input order", () => {
    const result = analyzeConversation(
      conversation({
        comments: [
          comment("bob", "third", "2026-09-09T09:00:00Z"),
          comment("alice", "second", "2026-09-09T08:00:00Z"),
        ],
      }),
      ALLOWED,
      AGENT,
    );

    expect(result.messages.map((m) => m.body)).toEqual([
      "Please add the check-issue command.",
      "second",
      "third",
    ]);
  });

  it("reports no new message when the allowed-user list is empty", () => {
    const result = analyzeConversation(
      conversation({ comments: [comment("alice", "hello", "2026-09-09T06:00:00Z")] }),
      [],
      AGENT,
    );

    expect(result.hasNewMessage).toBe(false);
    expect(result.messages).toHaveLength(0);
  });
});

describe("formatConversation", () => {
  it("renders author, kind, timestamp, and the new-message marker", () => {
    const { messages } = analyzeConversation(
      conversation({
        comments: [
          comment(AGENT, "working", "2026-09-09T07:00:00Z"),
          comment("bob", "one more thing", "2026-09-09T08:00:00Z"),
        ],
      }),
      ALLOWED,
      AGENT,
    );

    const text = formatConversation(messages);

    expect(text).toContain("[alice] issue description · 2026-09-09T05:00:00Z\nPlease add the check-issue command.");
    expect(text).toContain(`[${AGENT}] comment · 2026-09-09T07:00:00Z\nworking`);
    expect(text).toContain("[bob] comment · 2026-09-09T08:00:00Z · NEW since last agent run\none more thing");
  });

  it("separates messages with a blank line", () => {
    const { messages } = analyzeConversation(
      conversation({ comments: [comment("bob", "second", "2026-09-09T08:00:00Z")] }),
      ALLOWED,
      AGENT,
    );

    expect(formatConversation(messages).split("\n\n")).toHaveLength(2);
  });

  it("renders an empty string for no messages", () => {
    expect(formatConversation([])).toBe("");
  });
});
