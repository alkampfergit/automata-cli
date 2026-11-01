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
      return "agent-last";
    case "authorized":
      return "waiting";
    default:
      return "empty";
  }
}
