import type { IssueConversation } from "../config/githubService.js";
import {
  analyzeSurface,
  formatMessages,
  type AnalyzedMessage,
  type Participants,
  type RawMessage,
} from "./conversation.js";

export interface ConversationMessage {
  /** `issue` is the issue description; `comment` is a reply on the thread. */
  kind: "issue" | "comment";
  author: string;
  body: string;
  createdAt: string;
  /** True when this message arrived after the agent's last comment. */
  isNew: boolean;
}

export interface ConversationAnalysis {
  /** Messages from allowed users and the agent only, oldest first. */
  messages: ConversationMessage[];
  newMessageCount: number;
  hasNewMessage: boolean;
  /** Timestamp of the agent's newest comment, or null if it never commented. */
  lastAgentAt: string | null;
}

/**
 * Decide whether an allowed user has spoken since the agent's last comment, and
 * build the participant-filtered conversation to hand to the AI.
 *
 * The rules themselves live in `conversation.ts`, shared with `do-work`, so the
 * two callers cannot drift apart on the boundary rule. This function is only the
 * issue-shaped view of them.
 */
export function analyzeConversation(
  conversation: IssueConversation,
  allowedUsers: string[],
  agentUser: string,
): ConversationAnalysis {
  const participants: Participants = { allowedUsers, agentUser };

  const messages: RawMessage[] = [
    {
      kind: "issue-body",
      author: conversation.author,
      body: conversation.body,
      createdAt: conversation.createdAt,
    },
    ...conversation.comments.map((comment) => ({
      kind: "issue-comment" as const,
      author: comment.author,
      body: comment.body,
      createdAt: comment.createdAt,
    })),
  ];

  const analysis = analyzeSurface(messages, participants);

  return {
    messages: analysis.messages.map(toConversationMessage),
    newMessageCount: analysis.newMessageCount,
    hasNewMessage: analysis.hasNewMessage,
    lastAgentAt: analysis.lastAgentAt,
  };
}

function toConversationMessage(message: AnalyzedMessage): ConversationMessage {
  return {
    kind: message.kind === "issue-body" ? "issue" : "comment",
    author: message.author,
    body: message.body,
    createdAt: message.createdAt,
    isNew: message.isNew,
  };
}

/** Render the filtered conversation as plain text for the AI prompt. */
export function formatConversation(messages: ConversationMessage[]): string {
  return formatMessages(
    messages.map((message) => ({
      kind: message.kind === "issue" ? ("issue-body" as const) : ("issue-comment" as const),
      author: message.author,
      body: message.body,
      createdAt: message.createdAt,
      isNew: message.isNew,
    })),
  );
}
