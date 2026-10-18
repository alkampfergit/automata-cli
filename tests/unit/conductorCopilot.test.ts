import { describe, it, expect } from "vitest";
import { isCopilotAuthor, newestCopilotAt, openCopilotThreads, renderCopilotBlock } from "../../src/conductor/copilot.js";
import { decideConductorReply, decideConversation, prConversation } from "../../src/conductor/replyDecision.js";
import { composeConductorPrompt } from "../../src/conductor/thread.js";
import { REPLY_MARKER } from "../../src/conductor/loopSafety.js";
import type { RawMessage } from "../../src/github/conversation.js";
import type { PrSurface, ReviewThread } from "../../src/github/ghWorkService.js";

const p = { agentUser: "bot", allowedUsers: ["alice"] };

function msg(author: string, at: string, body = "x", kind: RawMessage["kind"] = "pr-comment"): RawMessage {
  return { kind, author, body, createdAt: `2026-10-01T${at}Z` };
}
function thread(resolved: boolean, comments: RawMessage[]): ReviewThread {
  return { path: "src/a.ts", line: 3, isResolved: resolved, comments, url: "https://gh/t/1" };
}
function surface(messages: RawMessage[], threads: ReviewThread[]): PrSurface {
  return {
    pr: { number: 9, url: "https://gh/pull/9", title: "T", headRefName: "f", baseRefName: "develop", isCrossRepository: false, state: "OPEN", isDraft: false, updatedAt: "" },
    assignees: [],
    messages,
    threads,
  };
}
const copilotThread = (resolved = false, at = "10:00:00") => thread(resolved, [msg("Copilot", at, "Use const", "thread-comment")]);

describe("copilot threads", () => {
  it("recognises Copilot logins", () => {
    expect(isCopilotAuthor("Copilot")).toBe(true);
    expect(isCopilotAuthor("copilot-pull-request-reviewer")).toBe(true);
    expect(isCopilotAuthor("alice")).toBe(false);
  });

  it("keeps only unresolved threads that Copilot started", () => {
    const human = thread(false, [msg("alice", "10:00:00", "x", "thread-comment"), msg("Copilot", "10:05:00", "x", "thread-comment")]);
    const open = openCopilotThreads(surface([], [copilotThread(), copilotThread(true), human]));
    expect(open).toHaveLength(1);
  });

  it("finds the newest Copilot comment", () => {
    expect(newestCopilotAt([copilotThread(false, "10:00:00"), copilotThread(false, "11:00:00")])).toBe("2026-10-01T11:00:00Z");
    expect(newestCopilotAt([])).toBeNull();
  });

  it("asks the model to instruct the agent to fix and resolve", () => {
    const text = renderCopilotBlock(9, [copilotThread()], "bot");
    expect(text).toContain("src/a.ts:3");
    expect(text).toContain("Use const");
    expect(text).toMatch(/instruction to bot: fix each comment.*resolve its review thread/);
  });
});

describe("a Copilot turn", () => {
  it("is owed when the agent did not speak last", () => {
    const d = decideConversation(prConversation(surface([msg("alice", "09:00:00")], [copilotThread()])), p);
    expect(d).toMatchObject({ kind: "reply", copilot: true });
  });

  it("is not owed once a resolved thread is all there is", () => {
    const d = decideConversation(prConversation(surface([msg("alice", "09:00:00")], [copilotThread(true)])), p);
    expect(d.kind).toBe("skip");
  });

  it("is not owed again after a conductor reply that follows Copilot", () => {
    const messages = [msg("alice", "11:00:00", `go\n${REPLY_MARKER}`)];
    expect(decideConversation(prConversation(surface(messages, [copilotThread(false, "10:00:00")])), p).kind).toBe("skip");
    expect(decideConversation(prConversation(surface(messages, [copilotThread(false, "12:00:00")])), p).kind).toBe("reply");
  });

  it("is stopped by the reply limit and the blocked label", () => {
    const conversation = prConversation(surface([], [copilotThread()]));
    const limit = decideConductorReply([conversation], p, { blocked: false, replies: 5, maxReplies: 5 });
    expect(limit.decisions[0]).toMatchObject({ kind: "skip", reason: "limit" });
    const blocked = decideConductorReply([conversation], p, { blocked: true, replies: 0, maxReplies: 5 });
    expect(blocked.decisions[0]).toMatchObject({ kind: "skip", reason: "blocked" });
  });

  it("puts the block in the prompt of a pull request with open Copilot threads", () => {
    const pr = surface([], [copilotThread()]);
    const prompt = composeConductorPrompt({ thread: { kind: "pr", prs: [{ surface: pr, checks: [] }] }, repo: { owner: "a", repo: "b" }, participants: p, frame: "F" });
    expect(prompt).toContain("Open Copilot review comments on pull request #9");
    const clean = composeConductorPrompt({ thread: { kind: "pr", prs: [{ surface: surface([], []), checks: [] }] }, repo: { owner: "a", repo: "b" }, participants: p, frame: "F" });
    expect(clean).not.toContain("Copilot");
  });
});
