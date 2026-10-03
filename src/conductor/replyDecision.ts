import { agentAnsweredAfter } from "../github/workDetection.js";
import { type Participants, type RawMessage } from "../github/conversation.js";
import type { IssueSurface, PrSurface } from "../github/ghWorkService.js";

/**
 * Pure rule for the conductor: does a watched item need a reply from an allowed
 * user? It is `do-work`'s question with the roles swapped — `do-work` answers
 * what an allowed user said last, the conductor answers what `agentUser` said
 * last — so it reuses `analyzeSurface` and `agentAnsweredAfter` rather than
 * restating "who spoke last".
 */

/** One conversation of a watched item, normalised from an issue or a pull request. */
export interface Conversation {
  kind: "issue" | "pr";
  number: number;
  /** `closed` covers a merged pull request too, as in `WatchTarget`. */
  state: "open" | "closed";
  messages: RawMessage[];
}

export type ConductorSkipReason =
  | "closed"
  | "no-agent-message"
  | "answered";

export type ConductorDecision =
  | { kind: "reply"; surface: Conversation; agentMessageAt: string; reason: string }
  | { kind: "skip"; surface: Conversation; reason: ConductorSkipReason; detail: string };

/**
 * The one rule for "is this item finished": the pruning of the watch list and
 * the reply decision both use it, so they cannot disagree about an item.
 */
export function isWatchClosed(state: Conversation["state"]): boolean {
  return state === "closed";
}

export function issueConversation(surface: IssueSurface): Conversation {
  return {
    kind: "issue",
    number: surface.issue.number,
    state: surface.state === "CLOSED" ? "closed" : "open",
    messages: surface.messages,
  };
}

/** Review-thread comments count: an agent comment in a thread is as unanswered as one in the conversation. */
export function prConversation(surface: PrSurface): Conversation {
  return {
    kind: "pr",
    number: surface.pr.number,
    state: surface.pr.state === "OPEN" ? "open" : "closed",
    messages: [...surface.messages, ...surface.threads.flatMap((thread) => thread.comments)],
  };
}

/**
 * Decide one conversation. The newest message of an allowed user or of the
 * agent is what matters; other accounts are ignored, as everywhere else. If
 * that is the agent's and no allowed user wrote after it, a reply is owed.
 *
 * Unlike `do-work`, an agent-authored issue description counts as a message the
 * agent is waiting on: an issue the agent opened and nobody commented on is
 * unanswered.
 */
export function decideConversation(conversation: Conversation, p: Participants): ConductorDecision {
  if (isWatchClosed(conversation.state)) {
    return { kind: "skip", surface: conversation, reason: "closed", detail: "the item is closed or merged" };
  }

  const agent = p.agentUser.toLowerCase();
  const allowed = new Set(p.allowedUsers.map((user) => user.toLowerCase()));
  const relevant = conversation.messages.filter((message) => {
    const author = message.author.toLowerCase();
    return author === agent || allowed.has(author);
  });

  let newest: RawMessage | null = null;
  for (const message of relevant) {
    if (message.author.toLowerCase() !== agent) continue;
    if (newest === null || message.createdAt > newest.createdAt) newest = message;
  }
  if (newest === null) {
    return {
      kind: "skip",
      surface: conversation,
      reason: "no-agent-message",
      detail: `${p.agentUser} has not written here`,
    };
  }

  // `agentAnsweredAfter` with the roles swapped: the "agent" asked is each allowed
  // user, the marker is the agent's newest message. An issue body never counts as
  // an answer, so the opener's own description cannot silence the agent's message.
  const marker = { commentId: "", createdAt: newest.createdAt };
  const answeredBy = p.allowedUsers.find((user) => agentAnsweredAfter(relevant, user, marker));
  if (answeredBy !== undefined) {
    return {
      kind: "skip",
      surface: conversation,
      reason: "answered",
      detail: `${answeredBy} answered after ${p.agentUser}'s message at ${newest.createdAt}`,
    };
  }

  return {
    kind: "reply",
    surface: conversation,
    agentMessageAt: newest.createdAt,
    reason: `${p.agentUser}'s message at ${newest.createdAt} has no answer from an allowed user`,
  };
}

export interface ConductorVerdict {
  /** True when any conversation of the item needs a reply. */
  needsReply: boolean;
  decisions: ConductorDecision[];
}

/** An issue and its linked pull request(s), or a lone pull request: each is decided on its own. */
export function decideConductorReply(conversations: Conversation[], p: Participants): ConductorVerdict {
  const decisions = conversations.map((conversation) => decideConversation(conversation, p));
  return { needsReply: decisions.some((decision) => decision.kind === "reply"), decisions };
}
