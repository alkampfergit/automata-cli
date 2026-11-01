import type { PrSurface } from "../github/ghWorkService.js";
import { openCopilotThreads } from "./copilot.js";

/**
 * Copilot review rounds. The conductor asks Copilot for a review of a pull request, waits for it, lets the agent fix the
 * comments, and asks again, up to the number of rounds that the `copilot-review-rounds` setting names.
 * The decision is pure: the caller reads the facts and acts on the answer.
 */

/** What the state file keeps for one pull request. */
export interface RoundRecord {
  /** The rounds asked for so far. */
  requested: number;
  /** The head commit when the last round was asked for. */
  headSha: string | null;
  /** Set when a request failed (for example, no Copilot licence): no more rounds for this pull request. */
  stopped?: string;
}

export interface RoundFacts {
  rounds: number;
  record: RoundRecord | undefined;
  headSha: string | null;
  /** Copilot is a requested reviewer and has not reviewed yet. */
  pending: boolean;
  openCopilotThreads: number;
  /** An open pull request that is not a draft. */
  reviewable: boolean;
}

export type RoundDecision =
  | { kind: "off" }
  | { kind: "wait" }
  | { kind: "fix" }
  | { kind: "request"; round: number }
  | { kind: "done"; reason: "rounds-reached" | "head-unchanged" | "stopped" };

/**
 * `off`: nothing is configured or the pull request cannot be reviewed. `wait`: a review is pending. `fix`: the review
 * left open threads; the normal turn tells the agent to fix them. `request`: ask for round `round`. `done`: no more rounds.
 * The label gate lets a pull request through on `off` and `done` only.
 */
export function decideCopilotRound(facts: RoundFacts): RoundDecision {
  if (facts.rounds <= 0 || !facts.reviewable) return { kind: "off" };
  if (facts.pending) return { kind: "wait" };
  if (facts.openCopilotThreads > 0) return { kind: "fix" };
  const requested = facts.record?.requested ?? 0;
  if (facts.record?.stopped !== undefined) return { kind: "done", reason: "stopped" };
  if (requested >= facts.rounds) return { kind: "done", reason: "rounds-reached" };
  // The first round needs no earlier head. A later one needs new code: the same head was reviewed already.
  if (requested > 0 && facts.headSha !== null && facts.headSha === facts.record?.headSha) {
    return { kind: "done", reason: "head-unchanged" };
  }
  return { kind: "request", round: requested + 1 };
}

/** The facts that come from the pull request; the caller adds the setting, the record and the pending flag. */
export function surfaceFacts(surface: PrSurface): Pick<RoundFacts, "headSha" | "openCopilotThreads" | "reviewable"> {
  return {
    headSha: surface.pr.headSha ?? null,
    openCopilotThreads: openCopilotThreads(surface).length,
    reviewable: surface.pr.state === "OPEN" && !surface.pr.isDraft,
  };
}

/** The decisions that let the `conductor-ready` label stand. */
export function roundsAllowReady(decision: RoundDecision): boolean {
  return decision.kind === "off" || decision.kind === "done";
}

export function describeRoundDecision(decision: RoundDecision, rounds: number): string {
  switch (decision.kind) {
    case "off":
      return "Copilot review rounds are off";
    case "wait":
      return "a Copilot review is pending";
    case "fix":
      return "the Copilot review left open threads";
    case "request":
      return `requesting Copilot review round ${String(decision.round)} of ${String(rounds)}`;
    case "done":
      return `Copilot review rounds are done (${decision.reason})`;
  }
}
