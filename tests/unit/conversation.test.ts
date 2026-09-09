import { describe, it, expect } from "vitest";
import {
  analyzeSurface,
  lastAuthorClass,
  formatMessages,
  type RawMessage,
  type Participants,
} from "../../src/github/conversation.js";

const PARTICIPANTS: Participants = { allowedUsers: ["alice", "bob"], agentUser: "automata-bot" };

function msg(author: string, createdAt: string, overrides: Partial<RawMessage> = {}): RawMessage {
  return { kind: "issue-comment", author, body: `${author} at ${createdAt}`, createdAt, ...overrides };
}

describe("analyzeSurface — the agent boundary", () => {
  it("takes the boundary from the newest agent message", () => {
    const result = analyzeSurface(
      [
        msg("alice", "2026-01-01T00:00:00Z"),
        msg("automata-bot", "2026-01-02T00:00:00Z"),
        msg("automata-bot", "2026-01-03T00:00:00Z"),
        msg("alice", "2026-01-04T00:00:00Z"),
      ],
      PARTICIPANTS,
    );
    expect(result.lastAgentAt).toBe("2026-01-03T00:00:00Z");
    expect(result.newMessages.map((m) => m.createdAt)).toEqual(["2026-01-04T00:00:00Z"]);
  });

  it("excludes the issue body from the boundary, so an agent-opened issue still processes", () => {
    const result = analyzeSurface(
      [
        msg("automata-bot", "2026-01-05T00:00:00Z", { kind: "issue-body" }),
        msg("alice", "2026-01-01T00:00:00Z"),
      ],
      PARTICIPANTS,
    );
    expect(result.lastAgentAt).toBeNull();
    expect(result.hasNewMessage).toBe(true);
  });

  it("treats every authorized message as new when the agent has never spoken", () => {
    const result = analyzeSurface(
      [msg("alice", "2026-01-01T00:00:00Z"), msg("bob", "2026-01-02T00:00:00Z")],
      PARTICIPANTS,
    );
    expect(result.lastAgentAt).toBeNull();
    expect(result.newMessageCount).toBe(2);
  });

  it("never counts an agent message as new, even when the agent is also listed as allowed", () => {
    const result = analyzeSurface(
      [msg("alice", "2026-01-01T00:00:00Z"), msg("automata-bot", "2026-01-02T00:00:00Z")],
      { allowedUsers: ["alice", "automata-bot"], agentUser: "automata-bot" },
    );
    expect(result.hasNewMessage).toBe(false);
    expect(result.newMessages).toEqual([]);
  });

  it("does not treat an exact timestamp tie as new", () => {
    const result = analyzeSurface(
      [msg("automata-bot", "2026-01-02T00:00:00Z"), msg("alice", "2026-01-02T00:00:00Z")],
      PARTICIPANTS,
    );
    expect(result.hasNewMessage).toBe(false);
  });
});

describe("analyzeSurface — authorization", () => {
  it("excludes unauthorized authors from detection and from the message list", () => {
    const result = analyzeSurface(
      [
        msg("alice", "2026-01-01T00:00:00Z"),
        msg("automata-bot", "2026-01-02T00:00:00Z"),
        msg("drive-by", "2026-01-03T00:00:00Z"),
      ],
      PARTICIPANTS,
    );
    expect(result.hasNewMessage).toBe(false);
    expect(result.messages.map((m) => m.author)).toEqual(["alice", "automata-bot"]);
    expect(JSON.stringify(result)).not.toMatch(/drive-by/);
  });

  it("matches logins case-insensitively", () => {
    const result = analyzeSurface(
      [msg("AUTOMATA-BOT", "2026-01-01T00:00:00Z"), msg("Alice", "2026-01-02T00:00:00Z")],
      PARTICIPANTS,
    );
    expect(result.lastAgentAt).toBe("2026-01-01T00:00:00Z");
    expect(result.newMessageCount).toBe(1);
  });

  it("returns messages oldest first regardless of input order", () => {
    const result = analyzeSurface(
      [msg("alice", "2026-01-03T00:00:00Z"), msg("bob", "2026-01-01T00:00:00Z")],
      PARTICIPANTS,
    );
    expect(result.messages.map((m) => m.createdAt)).toEqual([
      "2026-01-01T00:00:00Z",
      "2026-01-03T00:00:00Z",
    ]);
  });

  it("handles an empty surface", () => {
    const result = analyzeSurface([], PARTICIPANTS);
    expect(result).toEqual({
      messages: [],
      newMessages: [],
      newMessageCount: 0,
      hasNewMessage: false,
      lastAgentAt: null,
    });
  });
});

describe("lastAuthorClass", () => {
  it("reports the agent when the agent spoke last", () => {
    expect(
      lastAuthorClass([msg("alice", "2026-01-01T00:00:00Z"), msg("automata-bot", "2026-01-02T00:00:00Z")], PARTICIPANTS),
    ).toBe("agent");
  });

  it("reports authorized when an allowed user spoke last", () => {
    expect(
      lastAuthorClass([msg("automata-bot", "2026-01-01T00:00:00Z"), msg("bob", "2026-01-02T00:00:00Z")], PARTICIPANTS),
    ).toBe("authorized");
  });

  it("reports other when an unauthorized account spoke last", () => {
    expect(
      lastAuthorClass([msg("alice", "2026-01-01T00:00:00Z"), msg("copilot", "2026-01-02T00:00:00Z")], PARTICIPANTS),
    ).toBe("other");
  });

  it("reports none for an empty list", () => {
    expect(lastAuthorClass([], PARTICIPANTS)).toBe("none");
  });

  it("uses the newest message, not the input order", () => {
    expect(
      lastAuthorClass([msg("bob", "2026-01-05T00:00:00Z"), msg("automata-bot", "2026-01-01T00:00:00Z")], PARTICIPANTS),
    ).toBe("authorized");
  });
});

describe("formatMessages", () => {
  it("marks new messages and labels each kind", () => {
    const analysis = analyzeSurface(
      [
        msg("alice", "2026-01-01T00:00:00Z", { kind: "issue-body", body: "Please add a flag" }),
        msg("automata-bot", "2026-01-02T00:00:00Z", { body: "Here is a plan" }),
        msg("bob", "2026-01-03T00:00:00Z", { kind: "pr-comment", body: "Rename it" }),
      ],
      PARTICIPANTS,
    );
    const rendered = formatMessages(analysis.messages);
    expect(rendered).toContain("[alice] issue description · 2026-01-01T00:00:00Z\nPlease add a flag");
    expect(rendered).toContain("[automata-bot] comment · 2026-01-02T00:00:00Z\nHere is a plan");
    expect(rendered).toContain(
      "[bob] pull request comment · 2026-01-03T00:00:00Z · NEW since last agent run\nRename it",
    );
  });

  it("renders an empty list as an empty string", () => {
    expect(formatMessages([])).toBe("");
  });
});
