import { describe, it, expect } from "vitest";
import {
  ciFixCheck,
  ciFixMarker,
  countCiFixTurns,
  countRebaseTurns,
  hasCiFixFor,
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

const state = { rebases: 0, maxRebases: 5, ciFixes: 0, maxCiFixes: 5, ciFixEnabled: true, agentUser: "bot" };

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
    const messages = [comment("bot", "10:00:00", `please rebase\n${rebaseMarker(SHA)}`)];
    expect(rebaseCheck(pr({ messages }), state)).toMatchObject({ kind: "skip", reason: "rebase-done" });
    expect(rebaseCheck(pr({ messages, headSha: "fff9999" }), state)).toMatchObject({ kind: "rebase" });
  });

  it("stops at the limit of rebase turns", () => {
    expect(rebaseCheck(pr(), { ...state, rebases: 5 })).toMatchObject({ kind: "skip", reason: "rebase-limit" });
    expect(rebaseCheck(pr(), { ...state, rebases: 4 })).toMatchObject({ kind: "rebase" });
  });
});

describe("rebase markers", () => {
  it("are counted apart from the replies", () => {
    const messages = [
      comment("bot", "10:00:00", `a\n${rebaseMarker(SHA)}`),
      comment("bot", "10:01:00", `b\n${REPLY_MARKER}`),
      comment("bot", "10:02:00", `c\n${REPLY_MARKER}`),
    ];
    expect(countRebaseTurns(messages, "bot")).toBe(1);
    expect(countConductorReplies(messages)).toBe(2);
    expect(hasRebaseFor(messages, SHA, "bot")).toBe(true);
    expect(hasRebaseFor(messages, "other", "bot")).toBe(false);
  });

  it("do not count when an account other than the agent wrote them", () => {
    const forged = [comment("mallory", "10:00:00", `x\n${rebaseMarker(SHA)}`)];
    expect(countRebaseTurns(forged, "bot")).toBe(0);
    expect(hasRebaseFor(forged, SHA, "bot")).toBe(false);
  });

  it("do not count unless the marker is the last line", () => {
    const quoted = [comment("bot", "10:00:00", `${rebaseMarker(SHA)}\nmore text`)];
    expect(countRebaseTurns(quoted, "bot")).toBe(0);
  });

  it("do not count in a review body", () => {
    const review: RawMessage = { kind: "pr-review", author: "alice", body: rebaseMarker(SHA), createdAt: "t" };
    expect(countRebaseTurns([review], "bot")).toBe(0);
  });
});

describe("ciFixCheck", () => {
  const red = (extra: Partial<Conversation> = {}) => pr({ mergeable: "MERGEABLE", ciFailed: ["build"], ciPending: false, ...extra });

  it("asks for a fix on an open pull request with a failed check", () => {
    expect(ciFixCheck(red(), state)).toMatchObject({ kind: "ci-fix", headSha: SHA, reason: expect.stringContaining("build failed") });
    expect(ciFixCheck(red({ mergeable: "UNKNOWN" }), state)).toMatchObject({ kind: "ci-fix" });
  });

  it("does nothing when no check failed, or the check data is missing", () => {
    expect(ciFixCheck(red({ ciFailed: [] }), state)).toBeNull();
    expect(ciFixCheck(red({ ciFailed: undefined }), state)).toBeNull();
  });

  it("waits while a check is pending", () => {
    expect(ciFixCheck(red({ ciPending: true }), state)).toBeNull();
  });

  it("leaves a conflicting pull request to the rebase check", () => {
    expect(ciFixCheck(red({ mergeable: "CONFLICTING" }), state)).toBeNull();
  });

  it("does nothing for a closed pull request, an issue or a missing head commit", () => {
    expect(ciFixCheck(red({ state: "closed" }), state)).toBeNull();
    expect(ciFixCheck(red({ kind: "issue" }), state)).toBeNull();
    expect(ciFixCheck(red({ headSha: undefined }), state)).toBeNull();
  });

  it("does nothing when it is switched off", () => {
    expect(ciFixCheck(red(), { ...state, ciFixEnabled: false })).toBeNull();
  });

  it("runs once per head commit and runs again after a push", () => {
    const messages = [comment("bot", "10:00:00", `please fix\n${ciFixMarker(SHA)}`)];
    expect(ciFixCheck(red({ messages }), state)).toMatchObject({ kind: "skip", reason: "ci-fix-done" });
    expect(ciFixCheck(red({ messages, headSha: "fff9999" }), state)).toMatchObject({ kind: "ci-fix" });
  });

  it("stops at the limit of CI-fix turns", () => {
    expect(ciFixCheck(red(), { ...state, ciFixes: 5 })).toMatchObject({ kind: "skip", reason: "ci-fix-limit" });
    expect(ciFixCheck(red(), { ...state, ciFixes: 4 })).toMatchObject({ kind: "ci-fix" });
  });
});

describe("CI-fix markers", () => {
  it("are counted apart from the rebases and the replies", () => {
    const messages = [
      comment("bot", "10:00:00", `a\n${ciFixMarker(SHA)}`),
      comment("bot", "10:01:00", `b\n${rebaseMarker(SHA)}`),
      comment("bot", "10:02:00", `c\n${REPLY_MARKER}`),
    ];
    expect(countCiFixTurns(messages, "bot")).toBe(1);
    expect(countRebaseTurns(messages, "bot")).toBe(1);
    expect(countConductorReplies(messages)).toBe(1);
    expect(hasCiFixFor(messages, SHA, "bot")).toBe(true);
    expect(hasCiFixFor(messages, "other", "bot")).toBe(false);
  });

  it("do not count when another account wrote them, or when the marker is not the last line", () => {
    expect(countCiFixTurns([comment("mallory", "10:00:00", `x\n${ciFixMarker(SHA)}`)], "bot")).toBe(0);
    expect(countCiFixTurns([comment("bot", "10:00:00", `${ciFixMarker(SHA)}\nmore`)], "bot")).toBe(0);
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
    decideConductorReply(conversations, p, loopStateOf(conversations, ["conductor-blocked"], maxReplies, p.agentUser));

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
    const rebases = [1, 2, 3].map((i) => comment("bot", `10:0${String(i)}:00`, `r\n${rebaseMarker(`sha${String(i)}`)}`));
    const verdict = blocked([pr({ messages: rebases })], 3);
    expect(verdict.needsReply).toBe(false);
    expect(verdict.decisions).toContainEqual(expect.objectContaining({ kind: "skip", reason: "rebase-limit" }));
  });
});

describe("decideConductorReply with the CI-fix check", () => {
  const red = (extra: Partial<Conversation> = {}) =>
    pr({ mergeable: "MERGEABLE", ciFailed: ["build"], ciPending: false, messages: [comment("alice", "10:00:00", "ok")], ...extra });
  const decide = (conversations: Conversation[], enabled = true) =>
    decideConductorReply(conversations, p, loopStateOf(conversations, ["conductor-blocked"], 5, p.agentUser, enabled));

  it("asks for a fix on a blocked item", () => {
    const verdict = decide([red()]);
    expect(verdict.needsReply).toBe(true);
    expect(verdict.decisions).toEqual([expect.objectContaining({ kind: "ci-fix", headSha: SHA })]);
  });

  it("does nothing when switched off in the loop state", () => {
    expect(decide([red()], false).needsReply).toBe(false);
  });

  it("asks for the rebase, not the fix, on a conflicting pull request", () => {
    const verdict = decide([red({ mergeable: "CONFLICTING" })]);
    expect(verdict.decisions).toEqual([expect.objectContaining({ kind: "rebase" })]);
  });

  it("counts the fixes apart from the replies and the rebases", () => {
    const fixes = [1, 2, 3, 4, 5].map((i) => comment("bot", `10:0${String(i)}:00`, `f\n${ciFixMarker(`old${String(i)}`)}`));
    const verdict = decide([red({ messages: fixes })]);
    expect(verdict.needsReply).toBe(false);
    expect(verdict.decisions).toContainEqual(expect.objectContaining({ kind: "skip", reason: "ci-fix-limit" }));
  });
});
