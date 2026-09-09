import type { Participants, RawMessage } from "./conversation.js";

/**
 * What became of a turn, decided from the surface as it reads *after* the run.
 *
 * Split out from the command because it is the most safety-critical decision in
 * the loop — it governs whether a human message can be answered twice or lost —
 * and because it had accumulated four rounds of review fixes inline, past the
 * point anyone could hold it in their head.
 */

export interface AnswerAnalysis {
  /** Timestamp of the agent's newest message after the marker, or null. */
  answeredAt: string | null;
  /**
   * Authorized messages the agent's answer overtook without having seen: newer
   * than what actually went into the prompt, older than the answer. These are
   * the ones a stateless boundary loses, because the next tick compares against
   * the answer.
   */
  missed: RawMessage[];
  /**
   * Every authorized message newer than the prompt's watermark, including any
   * that arrived *after* the answer. Reporting is all-or-nothing: the report is
   * itself an agent message, so posting it buries these too — naming only the
   * `missed` subset would lose the rest.
   */
  toReport: RawMessage[];
}

function isAuthorized(author: string, p: Participants): boolean {
  const login = author.toLowerCase();
  return (
    login !== p.agentUser.toLowerCase() &&
    p.allowedUsers.some((user) => user.toLowerCase() === login)
  );
}

/**
 * The newest authorized message that actually reached the prompt.
 *
 * The marker is the wrong reference point for "did we see this?": the surfaces
 * are read, then the link map is paginated, then branches are fetched and
 * checked out, then the issue is assigned — seconds to tens of seconds before
 * the marker is posted. A message arriving in that window is older than the
 * marker, so measuring against the marker declares it seen when it was not.
 */
export function promptWatermark(messageSets: { createdAt: string }[][]): string | null {
  let watermark: string | null = null;
  for (const messages of messageSets) {
    for (const message of messages) {
      if (watermark === null || message.createdAt > watermark) watermark = message.createdAt;
    }
  }
  return watermark;
}

/**
 * Decide whether the agent answered, and which authorized messages its answer
 * silently overtook.
 *
 * `messages` is the answering surface re-read after the run — for a build turn
 * that includes review-thread comments, since a reply there is a real answer.
 */
/**
 * Authorized messages strictly between a watermark and a later agent comment —
 * the ones that comment buried without their having been seen.
 */
export function messagesBetween(
  messages: RawMessage[],
  p: Participants,
  watermark: string | null,
  until: string,
): RawMessage[] {
  const since = watermark ?? "";
  return messages.filter(
    (message) =>
      isAuthorized(message.author, p) && message.createdAt > since && message.createdAt <= until,
  );
}

export function analyseAnswer(
  messages: RawMessage[],
  p: Participants,
  marker: { createdAt: string },
  watermark: string | null,
): AnswerAnalysis {
  let answeredAt: string | null = null;
  for (const message of messages) {
    if (message.kind === "issue-body") continue;
    if (message.author.toLowerCase() !== p.agentUser.toLowerCase()) continue;
    // Strict: the marker itself must not count as the answer. GitHub timestamps
    // are second-resolution, so an answer posted inside the marker's second is
    // missed — a leftover marker, which is the safe direction.
    if (message.createdAt <= marker.createdAt) continue;
    if (answeredAt === null || message.createdAt > answeredAt) answeredAt = message.createdAt;
  }

  const since = watermark ?? marker.createdAt;
  const toReport = messages.filter(
    (message) => isAuthorized(message.author, p) && message.createdAt > since,
  );

  // Only what the answer overtook is *lost*. Anything newer than the answer is
  // still newer than the boundary, so the next tick picks it up unaided — it
  // needs no rescue, and treating it as a loss would raise a false alarm.
  // `<=`, not `<`. The boundary rule in `conversation.ts` treats "newer than the
  // agent's message" strictly, so a message in the *same second* as the answer is
  // not new next tick either — it would fall through both tests and vanish.
  // GitHub timestamps are second-resolution, so that tie is reachable. The safe
  // direction is a possible false flag, never a silent loss.
  const missed =
    answeredAt === null ? [] : toReport.filter((message) => message.createdAt <= answeredAt);

  return { answeredAt, missed, toReport };
}
