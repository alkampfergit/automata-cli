import { addCopilotReviewer } from "../config/githubService.js";
import {
  decideCopilotRound,
  describeRoundDecision,
  roundsAllowReady,
  surfaceFacts,
  type RoundDecision,
} from "../conductor/copilotRounds.js";
import { COPILOT_ROUNDS_KEY, findSetting, resolveSetting } from "../conductor/settings.js";
import { readRounds, readSettings, writeRound } from "../conductor/watchStore.js";
import { getCopilotReviewPending, getPrSurface, type PrSurface } from "../github/ghWorkService.js";

const ROUNDS_DEF = findSetting(COPILOT_ROUNDS_KEY);

/** The rounds setting of a pull request: its own, then the issues that link it, then the global one. */
export function roundsFor(prNumber: number, ownerIds: readonly number[]): number {
  if (ROUNDS_DEF === undefined) return 0;
  const value = resolveSetting(readSettings(), ROUNDS_DEF, [prNumber, ...ownerIds]).value;
  return typeof value === "number" ? value : 0;
}

/**
 * The decision for one pull request. A pull request with rounds off costs no extra `gh` call.
 * The pending status is read first; when no review is pending the surface is read again, so a review that finished
 * after the supplied surface was read cannot hide its threads. The returned surface is the one the decision used.
 */
export function copilotDecision(
  supplied: PrSurface,
  ownerIds: readonly number[],
): { decision: RoundDecision; rounds: number; surface: PrSurface } {
  const number = supplied.pr.number;
  const rounds = roundsFor(number, ownerIds);
  let surface = supplied;
  let facts = surfaceFacts(surface);
  let pending = false;
  if (rounds > 0 && facts.reviewable) {
    pending = getCopilotReviewPending(number);
    if (!pending) {
      surface = getPrSurface(number);
      facts = surfaceFacts(surface);
    }
  }
  const decision = decideCopilotRound({ rounds, record: readRounds()[String(number)], pending, ...facts });
  return { decision, rounds, surface };
}

/** Whether the configured rounds allow the `conductor-ready` label. A failed read keeps the label as it is: it throws. */
export function copilotRoundsDone(surface: PrSurface, ownerIds: readonly number[]): boolean {
  return roundsAllowReady(copilotDecision(surface, ownerIds).decision);
}

/**
 * Ask Copilot for the next round when the decision says so, and report whether the item waits.
 * A failed request is logged and ends the rounds of that pull request; the conductor goes on without Copilot.
 * A dry run reports the request and records nothing.
 */
export function advanceCopilotRounds(supplied: PrSurface, ownerIds: readonly number[], dryRun: boolean): { outcome: "wait" | "proceed"; surface: PrSurface } {
  const number = supplied.pr.number;
  const { decision, rounds, surface } = copilotDecision(supplied, ownerIds);
  if (decision.kind === "off") return { outcome: "proceed", surface };
  if (decision.kind === "wait") {
    process.stdout.write(`Conductor: PR #${String(number)}: ${describeRoundDecision(decision, rounds)}; waiting.\n`);
    return { outcome: "wait", surface };
  }
  if (decision.kind !== "request") return { outcome: "proceed", surface };
  const text = describeRoundDecision(decision, rounds);
  if (dryRun) {
    process.stdout.write(`Conductor: dry run, a tick would ask Copilot for a review of PR #${String(number)} (${text}).\n`);
    return { outcome: "wait", surface };
  }
  const headSha = surface.pr.headSha ?? null;
  try {
    addCopilotReviewer(number);
    writeRound(number, { requested: decision.round, headSha });
    process.stdout.write(`Conductor: PR #${String(number)}: ${text}; waiting for the review.\n`);
    return { outcome: "wait", surface };
  } catch (err) {
    const message = (err as Error).message;
    writeRound(number, { requested: readRounds()[String(number)]?.requested ?? 0, headSha, stopped: message });
    process.stderr.write(`Warning: could not ask Copilot to review PR #${String(number)}, going on without Copilot: ${message}\n`);
    return { outcome: "proceed", surface };
  }
}
