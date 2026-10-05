import type { RawMessage } from "../github/conversation.js";

/**
 * Did a conductor run post its reply? The run's stdout is discarded, so the only
 * proof is a comment of the conductor's own account that was not there before
 * the run. Pure: the caller reads the conversation before and after.
 */

export type ConductorReplyOutcome =
  | { kind: "posted"; count: number; runError: string | null }
  | { kind: "posted-nothing" }
  | { kind: "run-failed"; error: string }
  | { kind: "unverified"; error: string };

/** Only a comment counts as a reply: an edited issue body, a review or a thread comment does not. */
function isComment(message: RawMessage): boolean {
  return message.kind === "issue-comment" || message.kind === "pr-comment";
}

function key(message: RawMessage): string {
  return `${message.createdAt}\u0000${message.body}`;
}

/** The comments of `login` in `after` that `before` did not have. Case-insensitive on the login. */
export function newMessagesBy(before: RawMessage[], after: RawMessage[], login: string): RawMessage[] {
  const who = login.toLowerCase();
  const own = (m: RawMessage): boolean => isComment(m) && m.author.toLowerCase() === who;
  const known = new Set(before.filter(own).map(key));
  return after.filter((m) => own(m) && !known.has(key(m)));
}

export interface ConductReplyInput {
  login: string;
  /** Messages of the target conversation, read now. */
  read: () => RawMessage[];
  /** Run the model; rejects when it fails. */
  run: () => Promise<void>;
}

/**
 * Read, run, read again. A run that fails but still posted counts as posted — the
 * reply is there — and keeps the error for the log. A run that succeeds and posted
 * nothing is the silent failure this module exists to name.
 */
export async function conductReply(input: ConductReplyInput): Promise<ConductorReplyOutcome> {
  let before: RawMessage[];
  try {
    before = input.read();
  } catch (err) {
    return { kind: "unverified", error: `could not read the conversation before the run: ${(err as Error).message}` };
  }

  let runError: string | null = null;
  try {
    await input.run();
  } catch (err) {
    runError = (err as Error).message;
  }

  let after: RawMessage[];
  try {
    after = input.read();
  } catch (err) {
    return { kind: "unverified", error: `could not read the conversation after the run: ${(err as Error).message}` };
  }

  const posted = newMessagesBy(before, after, input.login);
  if (posted.length > 0) return { kind: "posted", count: posted.length, runError };
  return runError === null ? { kind: "posted-nothing" } : { kind: "run-failed", error: runError };
}
