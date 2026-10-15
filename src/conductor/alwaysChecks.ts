import type { RawMessage } from "../github/conversation.js";
import type { Conversation } from "./replyDecision.js";

/**
 * The checks the conductor makes on every watched item, even one that carries the
 * `conductor-blocked` label or has used its replies. Each is a pure function of one
 * conversation, so another can be added to `ALWAYS_CHECKS` without touching the
 * rest. Today there are two: the rebase check and the CI-fix check, in that order.
 */

/** Starts every rebase marker. It does not contain the reply marker, so the two counters stay apart. */
export const REBASE_MARKER_PREFIX = "<!-- automata:conductor-rebase";

/** Starts every CI-fix marker. It shares no prefix with the other markers, so the counters stay apart. */
export const CI_FIX_MARKER_PREFIX = "<!-- automata:conductor-ci-fix";

/** Ends a rebase request: it counts the turn and names the head commit the request was for. */
export function rebaseMarker(headSha: string): string {
  return `${REBASE_MARKER_PREFIX} head=${headSha} -->`;
}

/** Ends a CI-fix request: it counts the turn and names the head commit the request was for. */
export function ciFixMarker(headSha: string): string {
  return `${CI_FIX_MARKER_PREFIX} head=${headSha} -->`;
}

/** The marker when the last non-empty line of the body is one, and nothing follows it. */
function endingMarker(body: string, prefix: string): string | null {
  const last = body.trimEnd().split("\n").at(-1)?.trim() ?? "";
  return last.startsWith(prefix) && last.endsWith("-->") ? last : null;
}

/** Only comments of the agent count: another account cannot forge the state of a check. */
function markerComments(messages: RawMessage[], agentUser: string, prefix: string): string[] {
  const agent = agentUser.toLowerCase();
  const found: string[] = [];
  for (const message of messages) {
    if (message.kind !== "issue-comment" && message.kind !== "pr-comment") continue;
    if (message.author.toLowerCase() !== agent) continue;
    const marker = endingMarker(message.body, prefix);
    if (marker !== null) found.push(marker);
  }
  return found;
}

/** The rebase turns already on the messages. Only comments of the agent count, as for the replies. */
export function countRebaseTurns(messages: RawMessage[], agentUser: string): number {
  return markerComments(messages, agentUser, REBASE_MARKER_PREFIX).length;
}

/** True when a rebase turn already ran for this head commit. */
export function hasRebaseFor(messages: RawMessage[], headSha: string, agentUser: string): boolean {
  return markerComments(messages, agentUser, REBASE_MARKER_PREFIX).includes(rebaseMarker(headSha));
}

/** The CI-fix turns already on the messages. */
export function countCiFixTurns(messages: RawMessage[], agentUser: string): number {
  return markerComments(messages, agentUser, CI_FIX_MARKER_PREFIX).length;
}

/** True when a CI-fix turn already ran for this head commit. */
export function hasCiFixFor(messages: RawMessage[], headSha: string, agentUser: string): boolean {
  return markerComments(messages, agentUser, CI_FIX_MARKER_PREFIX).includes(ciFixMarker(headSha));
}

export type AlwaysSkipReason = "rebase-limit" | "rebase-done" | "ci-fix-limit" | "ci-fix-done";

export type AlwaysDecision =
  | { kind: "rebase"; surface: Conversation; headSha: string; reason: string }
  | { kind: "ci-fix"; surface: Conversation; headSha: string; reason: string }
  | { kind: "skip"; surface: Conversation; reason: AlwaysSkipReason; detail: string };

/** What the always checks need to know about the item as a whole. */
export interface AlwaysState {
  /** Rebase turns already on the item (the issue and its pull requests together). */
  rebases: number;
  maxRebases: number;
  /** CI-fix turns already on the item. */
  ciFixes: number;
  maxCiFixes: number;
  /** `conductor.ciFix.enabled`: false switches the CI-fix check off. */
  ciFixEnabled: boolean;
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

/**
 * A watched pull request with a failed check is owed a request to fix the build, once per head commit
 * and up to the limit. It waits while a check is pending, and leaves a conflicting pull request to the
 * rebase check: the checks of a conflicting branch say little, and a push re-arms both.
 */
export const ciFixCheck: AlwaysCheck = (conversation, state) => {
  if (!state.ciFixEnabled || conversation.kind !== "pr" || conversation.state !== "open") return null;
  const headSha = conversation.headSha;
  if (conversation.mergeable === "CONFLICTING" || headSha === undefined || headSha.length === 0) return null;
  const failed = conversation.ciFailed ?? [];
  if (failed.length === 0 || conversation.ciPending === true) return null;
  if (hasCiFixFor(conversation.messages, headSha, state.agentUser)) {
    return {
      kind: "skip",
      surface: conversation,
      reason: "ci-fix-done",
      detail: `a fix was already requested for head commit ${headSha.slice(0, 7)}; a new push re-arms the check`,
    };
  }
  if (state.ciFixes >= state.maxCiFixes) {
    return {
      kind: "skip",
      surface: conversation,
      reason: "ci-fix-limit",
      detail: `the conductor already asked for ${String(state.ciFixes)} fixes; the limit is conductor.maxRepliesPerItem (${String(state.maxCiFixes)})`,
    };
  }
  return {
    kind: "ci-fix",
    surface: conversation,
    headSha,
    reason: `${failed.join(", ")} failed at head commit ${headSha.slice(0, 7)}`,
  };
};

export const ALWAYS_CHECKS: AlwaysCheck[] = [rebaseCheck, ciFixCheck];

/** Every decision of every always check, in conversation order. */
export function runAlwaysChecks(conversations: Conversation[], state: AlwaysState): AlwaysDecision[] {
  return conversations.flatMap((conversation) =>
    ALWAYS_CHECKS.map((check) => check(conversation, state)).filter((decision): decision is AlwaysDecision => decision !== null),
  );
}
