import type { RawMessage } from "../github/conversation.js";
import type { Conversation } from "./replyDecision.js";

/**
 * The checks the conductor makes on every watched item, even one that carries the
 * `conductor-blocked` label or has used its replies. Each is a pure function of one
 * conversation, so another can be added to `ALWAYS_CHECKS` without touching the
 * rest. Today there is one: the rebase check.
 */

/** Starts every rebase marker. It does not contain the reply marker, so the two counters stay apart. */
export const REBASE_MARKER_PREFIX = "<!-- automata:conductor-rebase";

/** Ends a rebase request: it counts the turn and names the head commit the request was for. */
export function rebaseMarker(headSha: string): string {
  return `${REBASE_MARKER_PREFIX} head=${headSha} -->`;
}

/** True when the last non-empty line of the body is a rebase marker, and nothing follows it. */
function endsWithRebaseMarker(body: string): string | null {
  const last = body.trimEnd().split("\n").at(-1)?.trim() ?? "";
  return last.startsWith(REBASE_MARKER_PREFIX) && last.endsWith("-->") ? last : null;
}

/** Only comments of the agent count: another account cannot forge the state of the check. */
function rebaseComments(messages: RawMessage[], agentUser: string): Array<{ marker: string }> {
  const agent = agentUser.toLowerCase();
  const found: Array<{ marker: string }> = [];
  for (const message of messages) {
    if (message.kind !== "issue-comment" && message.kind !== "pr-comment") continue;
    if (message.author.toLowerCase() !== agent) continue;
    const marker = endsWithRebaseMarker(message.body);
    if (marker !== null) found.push({ marker });
  }
  return found;
}

/** The rebase turns already on the messages. Only comments of the agent count, as for the replies. */
export function countRebaseTurns(messages: RawMessage[], agentUser: string): number {
  return rebaseComments(messages, agentUser).length;
}

/** True when a rebase turn already ran for this head commit. */
export function hasRebaseFor(messages: RawMessage[], headSha: string, agentUser: string): boolean {
  const marker = rebaseMarker(headSha);
  return rebaseComments(messages, agentUser).some((comment) => comment.marker === marker);
}

export type AlwaysSkipReason = "rebase-limit" | "rebase-done";

export type AlwaysDecision =
  | { kind: "rebase"; surface: Conversation; headSha: string; reason: string }
  | { kind: "skip"; surface: Conversation; reason: AlwaysSkipReason; detail: string };

/** What the always checks need to know about the item as a whole. */
export interface AlwaysState {
  /** Rebase turns already on the item (the issue and its pull requests together). */
  rebases: number;
  maxRebases: number;
  /** The only account whose rebase markers count. */
  agentUser: string;
}

export type AlwaysCheck = (conversation: Conversation, state: AlwaysState) => AlwaysDecision | null;

/**
 * A watched pull request that GitHub says has a merge conflict is owed a rebase request,
 * once per head commit and up to the limit. `UNKNOWN` (not computed yet) and
 * `MERGEABLE` do nothing; the next tick reads `UNKNOWN` again.
 */
export const rebaseCheck: AlwaysCheck = (conversation, state) => {
  if (conversation.kind !== "pr" || conversation.state !== "open") return null;
  const headSha = conversation.headSha;
  if (conversation.mergeable !== "CONFLICTING" || headSha === undefined || headSha.length === 0) return null;
  if (hasRebaseFor(conversation.messages, headSha, state.agentUser)) {
    return {
      kind: "skip",
      surface: conversation,
      reason: "rebase-done",
      detail: `a rebase was already requested for head commit ${headSha.slice(0, 7)}; a new push re-arms the check`,
    };
  }
  if (state.rebases >= state.maxRebases) {
    return {
      kind: "skip",
      surface: conversation,
      reason: "rebase-limit",
      detail: `the conductor already asked for ${String(state.rebases)} rebases; the limit is conductor.maxRepliesPerItem (${String(state.maxRebases)})`,
    };
  }
  return {
    kind: "rebase",
    surface: conversation,
    headSha,
    reason: `the pull request conflicts with its base branch at head commit ${headSha.slice(0, 7)}`,
  };
};

export const ALWAYS_CHECKS: AlwaysCheck[] = [rebaseCheck];

/** Every decision of every always check, in conversation order. */
export function runAlwaysChecks(conversations: Conversation[], state: AlwaysState): AlwaysDecision[] {
  return conversations.flatMap((conversation) =>
    ALWAYS_CHECKS.map((check) => check(conversation, state)).filter((decision): decision is AlwaysDecision => decision !== null),
  );
}
