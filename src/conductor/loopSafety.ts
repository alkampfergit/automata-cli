import type { AutomataConductorConfig } from "../config/configStore.js";
import type { RawMessage } from "../github/conversation.js";

/**
 * Loop safety of the conductor: two unattended agents must not answer each other
 * for ever. The rules are pure; the caller reads the conversation and the labels.
 */

/** The label that stops the conductor on an item until a person removes it. */
export const BLOCKED_LABEL = "conductor-blocked";

/** Ends every conductor reply, so the replies can be counted from the conversation. */
export const REPLY_MARKER = "<!-- automata:conductor -->";

/** The prefix of the last line of the model's output when it needs a human. */
export const NEEDS_HUMAN_PREFIX = "NEEDS-HUMAN:";

export const DEFAULT_MAX_REPLIES_PER_ITEM = 5;

/** Hand-edited JSON: the reason `conductor.maxRepliesPerItem` is unusable, or null. */
export function maxRepliesProblem(conductor: AutomataConductorConfig | undefined): string | null {
  const value: unknown = conductor?.maxRepliesPerItem;
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return `conductor.maxRepliesPerItem must be a positive integer, got ${JSON.stringify(value)}.`;
  }
  return null;
}

export function resolveMaxReplies(conductor: AutomataConductorConfig | undefined): number {
  return conductor?.maxRepliesPerItem ?? DEFAULT_MAX_REPLIES_PER_ITEM;
}

/** The comments that carry the marker. Only comments count: an edited body or a review does not. */
export function countConductorReplies(messages: RawMessage[]): number {
  return messages.filter(
    (message) => (message.kind === "issue-comment" || message.kind === "pr-comment") && message.body.includes(REPLY_MARKER),
  ).length;
}

/** The model's reason when its final message ends with a `NEEDS-HUMAN:` line, else null. */
export function parseNeedsHuman(output: string): string | null {
  const lines = output.trim().split("\n");
  const last = lines[lines.length - 1]?.trim() ?? "";
  if (!last.startsWith(NEEDS_HUMAN_PREFIX)) return null;
  const reason = last.slice(NEEDS_HUMAN_PREFIX.length).trim();
  return reason.length > 0 ? reason : "no reason given";
}

/** What the decision needs to know about the item as a whole. */
export interface LoopState {
  blocked: boolean;
  /** Conductor replies already on the item (the issue and its pull requests together). */
  replies: number;
  maxReplies: number;
}
