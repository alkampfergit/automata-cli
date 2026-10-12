import { agentAnsweredAfter } from "../github/workDetection.js";
import { type Participants, type RawMessage } from "../github/conversation.js";
import type { IssueSurface, PrSurface } from "../github/ghWorkService.js";
import { BLOCKED_LABEL, REPLY_MARKER, countConductorReplies, type LoopState } from "./loopSafety.js";
import { newestCopilotAt, openCopilotThreads } from "./copilot.js";
import { countRebaseTurns, runAlwaysChecks, type AlwaysDecision, type AlwaysSkipReason } from "./alwaysChecks.js";

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
  /** Pull request only: the newest comment of Copilot in an unresolved review thread, if any. */
  copilotAt?: string | null;
  /** Pull request only: GitHub's merge state (`CONFLICTING`, `MERGEABLE`, `UNKNOWN`). */
  mergeable?: string;
  /** Pull request only: the commit the head branch points at. */
  headSha?: string;
}

export type ConductorSkipReason =
  | "closed"
  | "no-agent-message"
  | "answered"
  | "blocked"
  | "limit"
  | AlwaysSkipReason;

/** `rebase` comes from an always check (see `alwaysChecks.ts`) and ignores the loop-safety stop. */
export type ConductorDecision =
  | { kind: "reply"; surface: Conversation; agentMessageAt: string; reason: string; copilot?: true }
  | { kind: "skip"; surface: Conversation; reason: ConductorSkipReason; detail: string }
  | Extract<AlwaysDecision, { kind: "rebase" }>;

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
    copilotAt: newestCopilotAt(openCopilotThreads(surface)),
    mergeable: surface.pr.mergeable,
    headSha: surface.pr.headSha,
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
  const decision = decideByAgentMessage(conversation, p);
  if (decision.kind === "reply") return decision;
  return copilotTurn(conversation) ?? decision;
}

/**
 * An open Copilot thread is work owed when Copilot wrote after the conductor's
 * newest reply: the conductor has then not yet passed it on. Without that test an
 * open thread would draw a new reply on every tick until the agent resolves it.
 */
function copilotTurn(conversation: Conversation): ConductorDecision | null {
  const copilotAt = conversation.copilotAt ?? null;
  if (copilotAt === null || isWatchClosed(conversation.state)) return null;
  let lastReply = "";
  for (const message of conversation.messages) {
    if (message.body.includes(REPLY_MARKER) && message.createdAt > lastReply) lastReply = message.createdAt;
  }
  if (copilotAt <= lastReply) return null;
  return {
    kind: "reply",
    surface: conversation,
    agentMessageAt: copilotAt,
    copilot: true,
    reason: `an unresolved Copilot review thread has a comment at ${copilotAt} that no conductor reply follows`,
  };
}

function decideByAgentMessage(conversation: Conversation, p: Participants): ConductorDecision {
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

/**
 * An issue and its linked pull request(s), or a lone pull request: each is decided on its own.
 *
 * Loop safety applies to the item as a whole and only turns an owed reply into a
 * skip: a blocked item, or one that has reached its limit of conductor replies.
 */
export function decideConductorReply(
  conversations: Conversation[],
  p: Participants,
  loop?: LoopState,
): ConductorVerdict {
  // The always checks come first and ignore the stop: a rebase request replaces the
  // ordinary decision of its conversation, and a skipped one is listed beside it.
  const always = runAlwaysChecks(
    conversations,
    loop === undefined ? { rebases: 0, maxRebases: Infinity } : { rebases: loop.rebases, maxRebases: loop.maxRebases },
  );
  const decided = conversations.map((conversation) =>
    always.find((decision) => decision.kind === "rebase" && decision.surface === conversation) ?? decideConversation(conversation, p),
  );
  const stop = loop === undefined ? null : loopStop(loop);
  const decisions = decided.map((decision): ConductorDecision =>
    decision.kind === "reply" && stop !== null
      ? { kind: "skip", surface: decision.surface, reason: stop.reason, detail: stop.detail }
      : decision,
  );
  decisions.push(...always.filter((decision) => decision.kind === "skip"));
  return { needsReply: decisions.some((decision) => decision.kind !== "skip"), decisions };
}

function loopStop(loop: LoopState): { reason: "blocked" | "limit"; detail: string } | null {
  if (loop.blocked) {
    return { reason: "blocked", detail: `the item has the ${BLOCKED_LABEL} label; remove it to resume` };
  }
  if (loop.replies >= loop.maxReplies) {
    return {
      reason: "limit",
      detail: `the conductor already replied ${String(loop.replies)} times; the limit is conductor.maxRepliesPerItem (${String(loop.maxReplies)})`,
    };
  }
  return null;
}

/** The loop-safety state of an item from its conversations, its labels and the configured limit. */
export function loopStateOf(conversations: Conversation[], labels: string[], maxReplies: number): LoopState {
  return {
    blocked: labels.some((label) => label.toLowerCase() === BLOCKED_LABEL),
    replies: countConductorReplies(conversations.flatMap((conversation) => conversation.messages)),
    maxReplies,
    rebases: countRebaseTurns(conversations.flatMap((conversation) => conversation.messages)),
    maxRebases: maxReplies,
  };
}
