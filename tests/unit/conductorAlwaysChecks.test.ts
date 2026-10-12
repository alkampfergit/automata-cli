import { describe, it, expect } from "vitest";
import {
  countRebaseTurns,
  hasRebaseFor,
  rebaseCheck,
  rebaseMarker,
  runAlwaysChecks,
} from "../../src/conductor/alwaysChecks.js";
import { decideConductorReply, loopStateOf, type Conversation } from "../../src/conductor/replyDecision.js";
import { REPLY_MARKER, countConductorReplies } from "../../src/conductor/loopSafety.js";
import type { RawMessage } from "../../src/github/conversation.js";

const p = { agentUser: "bot", allowedUsers: ["alice"] };
const SHA = "abc1234def";

function comment(author: string, at: string, body: string): RawMessage {
  return { kind: "pr-comment", author, body, createdAt: `2026-10-01T${at}Z` };
}

function pr(extra: Partial<Conversation> = {}): Conversation {
  return { kind: "pr", number: 9, state: "open", messages: [], mergeable: "CONFLICTING", headSha: SHA, ...extra };
}

const state = { rebases: 0, maxRebases: 5 };

describe("rebaseCheck", () => {
  it("asks for a rebase on a conflicting open pull request", () => {
    expect(rebaseCheck(pr(), state)).toMatchObject({ kind: "rebase", headSha: SHA });
  });

  it.each(["UNKNOWN", "MERGEABLE", undefined])("does nothing when mergeable is %s", (mergeable) => {
    expect(rebaseCheck(pr({ mergeable }), state)).toBeNull();
  });

  it("does nothing for a closed pull request, an issue or a missing head commit", () => {
    expect(rebaseCheck(pr({ state: "closed" }), state)).toBeNull();
    expect(rebaseCheck(pr({ kind: "issue" }), state)).toBeNull();
    expect(rebaseCheck(pr({ headSha: undefined }), state)).toBeNull();
  });

  it("runs once per head commit and runs again after a push", () => {
    const messages = [comment("alice", "10:00:00", `please rebase\n${rebaseMarker(SHA)}`)];
    expect(rebaseCheck(pr({ messages }), state)).toMatchObject({ kind: "skip", reason: "rebase-done" });
    expect(rebaseCheck(pr({ messages, headSha: "fff9999" }), state)).toMatchObject({ kind: "rebase" });
  });

  it("stops at the limit of rebase turns", () => {
    expect(rebaseCheck(pr(), { rebases: 5, maxRebases: 5 })).toMatchObject({ kind: "skip", reason: "rebase-limit" });
    expect(rebaseCheck(pr(), { rebases: 4, maxRebases: 5 })).toMatchObject({ kind: "rebase" });
  });
});

describe("rebase markers", () => {
  it("are counted apart from the replies", () => {
    const messages = [
      comment("alice", "10:00:00", `a\n${rebaseMarker(SHA)}`),
      comment("alice", "10:01:00", `b\n${REPLY_MARKER}`),
      comment("alice", "10:02:00", `c\n${REPLY_MARKER}`),
    ];
    expect(countRebaseTurns(messages)).toBe(1);
    expect(countConductorReplies(messages)).toBe(2);
    expect(hasRebaseFor(messages, SHA)).toBe(true);
    expect(hasRebaseFor(messages, "other")).toBe(false);
  });

  it("do not count in a review body", () => {
    const review: RawMessage = { kind: "pr-review", author: "alice", body: rebaseMarker(SHA), createdAt: "t" };
    expect(countRebaseTurns([review])).toBe(0);
  });
});

describe("runAlwaysChecks", () => {
  it("lists the decisions of every conversation", () => {
    const decisions = runAlwaysChecks([pr(), pr({ number: 10, mergeable: "MERGEABLE" })], state);
    expect(decisions).toHaveLength(1);
  });
});

describe("decideConductorReply with the always checks", () => {
  const blocked = (conversations: Conversation[], maxReplies = 5) =>
    decideConductorReply(conversations, p, loopStateOf(conversations, ["conductor-blocked"], maxReplies));

  it("rebases a blocked item with a conflict, though no reply is owed", () => {
    const verdict = blocked([pr({ messages: [comment("alice", "10:00:00", "ok")] })]);
    expect(verdict.needsReply).toBe(true);
    expect(verdict.decisions).toEqual([expect.objectContaining({ kind: "rebase", headSha: SHA })]);
  });

  it("does not rebase a blocked item whose mergeable state is UNKNOWN", () => {
    const verdict = blocked([pr({ mergeable: "UNKNOWN" })]);
    expect(verdict.needsReply).toBe(false);
    expect(verdict.decisions.every((decision) => decision.kind === "skip")).toBe(true);
  });

  it("counts the rebases apart from the replies", () => {
    const replies = [1, 2, 3].map((i) => comment("alice", `10:0${String(i)}:00`, `r\n${REPLY_MARKER}`));
    expect(blocked([pr({ messages: replies })], 3).decisions).toEqual([expect.objectContaining({ kind: "rebase" })]);
    const rebases = [1, 2, 3].map((i) => comment("alice", `10:0${String(i)}:00`, `r\n${rebaseMarker(`sha${String(i)}`)}`));
    const verdict = blocked([pr({ messages: rebases })], 3);
    expect(verdict.needsReply).toBe(false);
    expect(verdict.decisions).toContainEqual(expect.objectContaining({ kind: "skip", reason: "rebase-limit" }));
  });
});
