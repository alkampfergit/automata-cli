/**
 * The rules that decide whether the agent owes an answer on a conversation.
 *
 * Deliberately remote-agnostic and free of I/O: every caller normalises its own
 * payload into `RawMessage[]` first. That keeps the rules — which are the most
 * safety-critical part of the autonomous loop — testable without a `gh` binary,
 * and lets a second backend reuse them instead of reimplementing them.
 */

/** Where a message came from. Used for the boundary rule and for rendering. */
export type MessageKind = "issue-body" | "issue-comment" | "pr-comment" | "pr-review" | "thread-comment";

export interface RawMessage {
  kind: MessageKind;
  author: string;
  body: string;
  createdAt: string;
}

export interface AnalyzedMessage extends RawMessage {
  /** True when this message arrived after the agent's last message on this surface. */
  isNew: boolean;
}

export interface SurfaceAnalysis {
  /** Authorized and agent messages only, oldest first. */
  messages: AnalyzedMessage[];
  newMessages: AnalyzedMessage[];
  newMessageCount: number;
  hasNewMessage: boolean;
  /** Timestamp of the agent's newest message, or null if it never spoke here. */
  lastAgentAt: string | null;
}

export interface Participants {
  allowedUsers: string[];
  agentUser: string;
}

export type AuthorClass = "agent" | "authorized" | "other" | "none";

const KIND_LABELS: Record<MessageKind, string> = {
  "issue-body": "issue description",
  "issue-comment": "comment",
  "pr-comment": "pull request comment",
  "pr-review": "pull request review",
  "thread-comment": "review thread comment",
};

function byCreatedAt(a: RawMessage, b: RawMessage): number {
  return a.createdAt.localeCompare(b.createdAt);
}

function classify(author: string, p: Participants): Exclude<AuthorClass, "none"> {
  const login = author.toLowerCase();
  if (login === p.agentUser.toLowerCase()) return "agent";
  return p.allowedUsers.some((user) => user.toLowerCase() === login) ? "authorized" : "other";
}

/**
 * Split a surface's messages into what the agent may read and what it still owes
 * an answer to.
 *
 * The boundary is the agent's own newest message, so no local state is needed
 * and the behaviour survives across machines, containers and CI runners. The
 * issue body never acts as a boundary: an issue opened by the agent must still
 * be processed.
 */
export function analyzeSurface(messages: RawMessage[], p: Participants): SurfaceAnalysis {
  const ordered = [...messages].sort(byCreatedAt);

  let lastAgentAt: string | null = null;
  for (const message of ordered) {
    if (message.kind === "issue-body") continue;
    if (classify(message.author, p) !== "agent") continue;
    if (lastAgentAt === null || message.createdAt > lastAgentAt) {
      lastAgentAt = message.createdAt;
    }
  }

  const kept: AnalyzedMessage[] = [];
  for (const message of ordered) {
    const authorClass = classify(message.author, p);
    if (authorClass === "other") continue;
    // Strict inequality: a tie is not new, so the agent's own marker comment can
    // never retrigger the turn that produced it.
    const isNew =
      authorClass === "authorized" && (lastAgentAt === null || message.createdAt > lastAgentAt);
    kept.push({ ...message, isNew });
  }

  const newMessages = kept.filter((message) => message.isNew);

  return {
    messages: kept,
    newMessages,
    newMessageCount: newMessages.length,
    hasNewMessage: newMessages.length > 0,
    lastAgentAt,
  };
}

/**
 * Who spoke last on a surface. Used to decide whether a review thread still
 * needs an answer: the agent having spoken last means answered, even while the
 * thread is unresolved, because resolving is the reviewer's action.
 */
export function lastAuthorClass(messages: RawMessage[], p: Participants): AuthorClass {
  if (messages.length === 0) return "none";
  const newest = [...messages].sort(byCreatedAt).at(-1);
  return newest === undefined ? "none" : classify(newest.author, p);
}

/** Render an analysed conversation as plain text for a prompt. */
export function formatMessages(messages: AnalyzedMessage[]): string {
  return messages
    .map((message) => {
      const marker = message.isNew ? " · NEW since last agent run" : "";
      return `[${message.author}] ${KIND_LABELS[message.kind]} · ${message.createdAt}${marker}\n${message.body}`;
    })
    .join("\n\n");
}
