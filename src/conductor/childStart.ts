import { decideConversation } from "./replyDecision.js";
import { analyzeSurface, lastAuthorClass, type Participants, type RawMessage } from "../github/conversation.js";

/**
 * What the start step does with a child that has no discovery setting yet. Pure: the caller reads the comments.
 * Only comments of allowed accounts and the agent count; the issue body is not a message.
 */
export type ChildThreadState = "empty" | "waiting" | "agent-last";

export function classifyChildThread(messages: RawMessage[], participants: Participants): ChildThreadState {
  const comments = analyzeSurface(messages, participants).messages.filter((message) => message.kind !== "issue-body");
  switch (lastAuthorClass(comments, participants)) {
    case "agent":
      return agentRunInFlight(messages, participants) ? "waiting" : "agent-last";
    case "authorized":
      return "waiting";
    default:
      return "empty";
  }
}

/**
 * A `working…` marker of the agent that no real agent message or later human message follows means a
 * `do-work` run is answering now (for example from `do-work --issue N`). The conductor's reply rule decides
 * that, with its timestamp-tie and stale-marker handling, so the start step reuses it.
 */
function agentRunInFlight(messages: RawMessage[], participants: Participants): boolean {
  const decision = decideConversation({ kind: "issue", number: 0, state: "open", messages }, participants);
  return decision.kind === "skip" && decision.reason === "agent-working";
}
