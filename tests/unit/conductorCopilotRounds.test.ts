import { describe, expect, it } from "vitest";
import { decideCopilotRound, roundsAllowReady, type RoundFacts } from "../../src/conductor/copilotRounds.js";

const base: RoundFacts = { rounds: 2, record: undefined, headSha: "a", pending: false, openCopilotThreads: 0, reviewable: true };
const decide = (extra: Partial<RoundFacts>) => decideCopilotRound({ ...base, ...extra });

describe("decideCopilotRound", () => {
  it("is off with no rounds, or when the pull request cannot be reviewed", () => {
    expect(decide({ rounds: 0 })).toEqual({ kind: "off" });
    expect(decide({ reviewable: false })).toEqual({ kind: "off" });
  });

  it("requests round 1 first", () => {
    expect(decide({})).toEqual({ kind: "request", round: 1 });
  });

  it("waits while a review is pending, before anything else", () => {
    expect(decide({ pending: true, openCopilotThreads: 2 })).toEqual({ kind: "wait" });
  });

  it("asks the normal turn to fix open threads, also after the last round", () => {
    expect(decide({ openCopilotThreads: 1 })).toEqual({ kind: "fix" });
    expect(decide({ openCopilotThreads: 1, record: { requested: 2, headSha: "a" } })).toEqual({ kind: "fix" });
  });

  it("requests the next round on a new head once the threads are resolved", () => {
    expect(decide({ headSha: "b", record: { requested: 1, headSha: "a" } })).toEqual({ kind: "request", round: 2 });
  });

  it("is done on the same head: Copilot saw this code already", () => {
    expect(decide({ record: { requested: 1, headSha: "a" } })).toEqual({ kind: "done", reason: "head-unchanged" });
  });

  it("is done when the rounds are reached", () => {
    expect(decide({ headSha: "b", record: { requested: 2, headSha: "a" } })).toEqual({ kind: "done", reason: "rounds-reached" });
  });

  it("is done after a failed request", () => {
    expect(decide({ record: { requested: 0, headSha: "a", stopped: "no licence" } })).toEqual({ kind: "done", reason: "stopped" });
  });

  it("lets the ready label stand only on off and done", () => {
    expect(roundsAllowReady({ kind: "off" })).toBe(true);
    expect(roundsAllowReady({ kind: "done", reason: "stopped" })).toBe(true);
    for (const kind of ["wait", "fix"] as const) expect(roundsAllowReady({ kind })).toBe(false);
    expect(roundsAllowReady({ kind: "request", round: 1 })).toBe(false);
  });
});
