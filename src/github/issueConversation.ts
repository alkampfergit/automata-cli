import type { IssueConversation } from "../config/githubService.js";

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
 * The agent's newest comment is the last-execution boundary, so no local state
 * is needed. Agent messages are never counted as new — otherwise the marker
 * comment the agent posts would retrigger the next run indefinitely.
 */
export function analyzeConversation(
  conversation: IssueConversation,
  allowedUsers: string[],
  agentUser: string,
): ConversationAnalysis {
  const agent = agentUser.toLowerCase();
  const allowed = new Set(allowedUsers.map((user) => user.toLowerCase()));

  let lastAgentAt: string | null = null;
  for (const comment of conversation.comments) {
    if (comment.author.toLowerCase() !== agent) continue;
    if (lastAgentAt === null || comment.createdAt > lastAgentAt) {
      lastAgentAt = comment.createdAt;
    }
  }

  const entries: Omit<ConversationMessage, "isNew">[] = [
    {
      kind: "issue" as const,
      author: conversation.author,
      body: conversation.body,
      createdAt: conversation.createdAt,
    },
    ...conversation.comments.map((c) => ({
      kind: "comment" as const,
      author: c.author,
      body: c.body,
      createdAt: c.createdAt,
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const messages: ConversationMessage[] = [];
  for (const entry of entries) {
    const author = entry.author.toLowerCase();
    const isAgent = author === agent;
    if (!isAgent && !allowed.has(author)) continue;
    const isNew = !isAgent && (lastAgentAt === null || entry.createdAt > lastAgentAt);
    messages.push({ ...entry, isNew });
  }

  const newMessageCount = messages.filter((m) => m.isNew).length;

  return { messages, newMessageCount, hasNewMessage: newMessageCount > 0, lastAgentAt };
}

/** Render the filtered conversation as plain text for the AI prompt. */
export function formatConversation(messages: ConversationMessage[]): string {
  return messages
    .map((message) => {
      const kind = message.kind === "issue" ? "issue description" : "comment";
      const marker = message.isNew ? " · NEW since last agent run" : "";
      return `[${message.author}] ${kind} · ${message.createdAt}${marker}\n${message.body}`;
    })
    .join("\n\n");
}
