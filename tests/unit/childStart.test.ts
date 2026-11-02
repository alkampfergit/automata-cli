import { describe, it, expect } from "vitest";
import { classifyChildThread } from "../../src/conductor/childStart.js";
import type { RawMessage } from "../../src/github/conversation.js";
import { WORKING_MARKER } from "../../src/github/workingMarker.js";

const participants = { allowedUsers: ["alice"], agentUser: "bot" };

function comment(author: string, createdAt: string): RawMessage {
  return { kind: "issue-comment", author, body: "x", createdAt };
}

const body: RawMessage = { kind: "issue-body", author: "alice", body: "the story", createdAt: "2026-01-01T00:00:00Z" };

describe("classifyChildThread", () => {
  it("is empty for a child with no comment, also when it has a body", () => {
    expect(classifyChildThread([], participants)).toBe("empty");
    expect(classifyChildThread([body], participants)).toBe("empty");
  });

  it("is empty when only an unauthorized account commented", () => {
    expect(classifyChildThread([body, comment("mallory", "2026-01-01T00:01:00Z")], participants)).toBe("empty");
  });

  it("waits when the newest comment is from an authorized account", () => {
    const thread = [body, comment("alice", "2026-01-01T00:01:00Z"), comment("bot", "2026-01-01T00:02:00Z"), comment("alice", "2026-01-01T00:03:00Z")];
    expect(classifyChildThread(thread, participants)).toBe("waiting");
  });

  it("is agent-last when the newest comment is from the agent", () => {
    const thread = [body, comment("alice", "2026-01-01T00:01:00Z"), comment("bot", "2026-01-01T00:02:00Z")];
    expect(classifyChildThread(thread, participants)).toBe("agent-last");
  });

  it("ignores an unauthorized comment after the agent", () => {
    const thread = [comment("bot", "2026-01-01T00:02:00Z"), comment("mallory", "2026-01-01T00:03:00Z")];
    expect(classifyChildThread(thread, participants)).toBe("agent-last");
  });

  describe("in-flight marker", () => {
    const marker = (createdAt: string): RawMessage => ({ kind: "issue-comment", author: "bot", body: WORKING_MARKER, createdAt });

    it("waits while a working marker is the newest agent message", () => {
      const thread = [comment("alice", "2026-01-01T00:01:00Z"), marker("2026-01-01T00:02:00Z")];
      expect(classifyChildThread(thread, participants)).toBe("waiting");
    });

    it("is agent-last when a real agent message follows the marker", () => {
      const thread = [marker("2026-01-01T00:01:00Z"), comment("bot", "2026-01-01T00:02:00Z")];
      expect(classifyChildThread(thread, participants)).toBe("agent-last");
    });

    it("is agent-last when a real agent message ties with the marker", () => {
      const thread = [marker("2026-01-01T00:01:00Z"), comment("bot", "2026-01-01T00:01:00Z")];
      expect(classifyChildThread(thread, participants)).toBe("agent-last");
    });

    it("waits, as for any human message, when a human wrote after the marker", () => {
      const thread = [comment("bot", "2026-01-01T00:00:00Z"), marker("2026-01-01T00:01:00Z"), comment("alice", "2026-01-01T00:02:00Z")];
      expect(classifyChildThread(thread, participants)).toBe("waiting");
    });
  });
});
