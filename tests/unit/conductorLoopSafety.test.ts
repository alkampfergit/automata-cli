import { describe, it, expect } from "vitest";
import {
  countConductorReplies,
  maxRepliesProblem,
  parseNeedsHuman,
  resolveMaxReplies,
  REPLY_MARKER,
} from "../../src/conductor/loopSafety.js";
import { decideConductorReply, loopStateOf, type Conversation } from "../../src/conductor/replyDecision.js";
import { postingInstruction, dryRunInstruction } from "../../src/conductor/thread.js";
import type { RawMessage } from "../../src/github/conversation.js";

const msg = (kind: RawMessage["kind"], author: string, createdAt: string, body: string): RawMessage => ({ kind, author, createdAt, body });
const P = { allowedUsers: ["alice"], agentUser: "bot" };

describe("countConductorReplies", () => {
  it("counts only comments that carry the marker", () => {
    expect(
      countConductorReplies([
        msg("issue-comment", "alice", "1", `a ${REPLY_MARKER}`),
        msg("pr-comment", "alice", "2", REPLY_MARKER),
        msg("issue-comment", "alice", "3", "no marker"),
        msg("pr-review", "alice", "4", REPLY_MARKER),
      ]),
    ).toBe(2);
  });
});

describe("parseNeedsHuman", () => {
  it("reads the last line", () => {
    expect(parseNeedsHuman("text\nNEEDS-HUMAN: policy call\n")).toBe("policy call");
  });
  it("gives a reason when there is none", () => {
    expect(parseNeedsHuman("NEEDS-HUMAN:")).toBe("no reason given");
  });
  it("ignores the marker anywhere but the last line", () => {
    expect(parseNeedsHuman("NEEDS-HUMAN: x\nand a reply")).toBeNull();
    expect(parseNeedsHuman("")).toBeNull();
  });
});

describe("maxRepliesPerItem", () => {
  it("defaults to 5", () => {
    expect(resolveMaxReplies(undefined)).toBe(5);
    expect(resolveMaxReplies({ maxRepliesPerItem: 3 })).toBe(3);
  });
  it.each([0, -1, 1.5, "5", NaN])("rejects %s", (value) => {
    expect(maxRepliesProblem({ maxRepliesPerItem: value as number })).toMatch(/positive integer/);
  });
  it("accepts unset and positive integers", () => {
    expect(maxRepliesProblem(undefined)).toBeNull();
    expect(maxRepliesProblem({ maxRepliesPerItem: 1 })).toBeNull();
  });
});

describe("decideConductorReply with loop safety", () => {
  const owed = (state: "open" | "closed" = "open"): Conversation => ({
    kind: "issue",
    number: 1,
    state,
    messages: [msg("issue-comment", "bot", "2026-10-01T00:00:00Z", "q?")],
  });
  const loop = (over: object = {}) => ({ blocked: false, replies: 0, maxReplies: 5, ...over });

  it("replies below the limit", () => {
    expect(decideConductorReply([owed()], P, loop({ replies: 4 })).needsReply).toBe(true);
  });
  it("skips at the limit", () => {
    const verdict = decideConductorReply([owed()], P, loop({ replies: 5 }));
    expect(verdict.needsReply).toBe(false);
    expect(verdict.decisions[0]).toMatchObject({ kind: "skip", reason: "limit" });
  });
  it("skips a blocked item, before the limit", () => {
    expect(decideConductorReply([owed()], P, loop({ blocked: true, replies: 9 })).decisions[0]).toMatchObject({
      reason: "blocked",
    });
  });
  it("keeps closed as the reason for a closed item", () => {
    expect(decideConductorReply([owed("closed")], P, loop({ blocked: true })).decisions[0]).toMatchObject({ reason: "closed" });
  });
  it("counts replies on the issue and its pull requests together", () => {
    const pr: Conversation = {
      kind: "pr",
      number: 2,
      state: "open",
      messages: [msg("pr-comment", "alice", "1", REPLY_MARKER)],
    };
    const issue = { ...owed(), messages: [...owed().messages, msg("issue-comment", "alice", "0", REPLY_MARKER)] };
    expect(loopStateOf([issue, pr], ["Conductor-Blocked"], 5)).toEqual({ blocked: true, replies: 2, maxReplies: 5 });
  });
});

describe("instructions", () => {
  const target = { kind: "issue" as const, number: 7 };
  it("a live reply carries the marker and the needs-a-human line", () => {
    const text = postingInstruction(target);
    expect(text).toContain(REPLY_MARKER);
    expect(text).toContain("NEEDS-HUMAN:");
  });
  it("a dry run offers the needs-a-human line only", () => {
    const text = dryRunInstruction(target);
    expect(text).toContain("NEEDS-HUMAN:");
    expect(text).not.toContain(REPLY_MARKER);
  });
});
