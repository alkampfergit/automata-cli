import { describe, it, expect } from "vitest";
import { analyseAnswer, messagesBetween, promptWatermark } from "../../src/github/markerReconciliation.js";
import type { Participants, RawMessage } from "../../src/github/conversation.js";

const P: Participants = { allowedUsers: ["alice", "bob"], agentUser: "automata-bot" };
const MARKER = { createdAt: "2026-01-10T00:00:00Z" };

function msg(author: string, createdAt: string, kind: RawMessage["kind"] = "issue-comment"): RawMessage {
  return { kind, author, body: `${author}@${createdAt}`, createdAt };
}

describe("promptWatermark", () => {
  it("takes the newest timestamp across every surface the prompt carried", () => {
    expect(
      promptWatermark([
        [{ createdAt: "2026-01-01T00:00:00Z" }],
        [{ createdAt: "2026-01-05T00:00:00Z" }],
      ]),
    ).toBe("2026-01-05T00:00:00Z");
  });

  it("is null when the prompt carried nothing", () => {
    expect(promptWatermark([])).toBeNull();
    expect(promptWatermark([[]])).toBeNull();
  });
});

describe("analyseAnswer — did the agent answer?", () => {
  it("finds an agent message newer than the marker", () => {
    const result = analyseAnswer([msg("automata-bot", "2026-01-10T00:05:00Z")], P, MARKER, null);
    expect(result.answeredAt).toBe("2026-01-10T00:05:00Z");
  });

  it("does not count the marker itself", () => {
    expect(analyseAnswer([msg("automata-bot", MARKER.createdAt)], P, MARKER, null).answeredAt).toBeNull();
  });

  it("does not count an agent message older than the marker", () => {
    expect(analyseAnswer([msg("automata-bot", "2026-01-09T00:00:00Z")], P, MARKER, null).answeredAt).toBeNull();
  });

  it("counts a reply inside a review thread", () => {
    const result = analyseAnswer(
      [msg("automata-bot", "2026-01-10T00:05:00Z", "thread-comment")],
      P,
      MARKER,
      null,
    );
    expect(result.answeredAt).toBe("2026-01-10T00:05:00Z");
  });

  it("ignores the issue body, which cannot be an answer", () => {
    expect(
      analyseAnswer([msg("automata-bot", "2026-01-11T00:00:00Z", "issue-body")], P, MARKER, null).answeredAt,
    ).toBeNull();
  });

  it("takes the newest of several agent messages", () => {
    const result = analyseAnswer(
      [msg("automata-bot", "2026-01-10T00:02:00Z"), msg("automata-bot", "2026-01-10T00:09:00Z")],
      P,
      MARKER,
      null,
    );
    expect(result.answeredAt).toBe("2026-01-10T00:09:00Z");
  });
});

describe("messagesBetween", () => {
  it("returns authorized messages a later agent comment buried", () => {
    const buried = messagesBetween(
      [
        msg("alice", "2026-01-01T00:00:00Z"),
        msg("alice", "2026-01-05T00:00:00Z"),
        msg("alice", "2026-01-20T00:00:00Z"),
      ],
      P,
      "2026-01-01T00:00:00Z",
      "2026-01-10T00:00:00Z",
    );
    expect(buried.map((m) => m.createdAt)).toEqual(["2026-01-05T00:00:00Z"]);
  });

  it("includes a message in the same second as the burying comment", () => {
    const buried = messagesBetween([msg("alice", "2026-01-10T00:00:00Z")], P, null, "2026-01-10T00:00:00Z");
    expect(buried).toHaveLength(1);
  });

  it("excludes the agent's own and unauthorized messages", () => {
    const buried = messagesBetween(
      [msg("automata-bot", "2026-01-05T00:00:00Z"), msg("drive-by", "2026-01-05T00:00:00Z")],
      P,
      null,
      "2026-01-10T00:00:00Z",
    );
    expect(buried).toEqual([]);
  });
});

describe("analyseAnswer — messages the answer overtook", () => {
  const watermark = "2026-01-09T12:00:00Z";

  it("flags a message that arrived after the prompt was built and before the answer", () => {
    // The window that matters: the marker is posted several API calls after the
    // surfaces are read, so measuring from the marker would call this seen.
    const result = analyseAnswer(
      [
        msg("alice", "2026-01-09T12:00:00Z"),
        msg("alice", "2026-01-09T23:59:00Z"),
        msg("automata-bot", "2026-01-10T00:05:00Z"),
      ],
      P,
      MARKER,
      watermark,
    );
    expect(result.missed.map((m) => m.createdAt)).toEqual(["2026-01-09T23:59:00Z"]);
  });

  it("does not flag a message the prompt already carried", () => {
    const result = analyseAnswer(
      [msg("alice", watermark), msg("automata-bot", "2026-01-10T00:05:00Z")],
      P,
      MARKER,
      watermark,
    );
    expect(result.missed).toEqual([]);
    expect(result.toReport).toEqual([]);
  });

  it("does not treat a message newer than the answer as lost", () => {
    // It is still newer than the boundary, so the next tick picks it up unaided.
    const result = analyseAnswer(
      [msg("automata-bot", "2026-01-10T00:05:00Z"), msg("alice", "2026-01-10T00:09:00Z")],
      P,
      MARKER,
      watermark,
    );
    expect(result.missed).toEqual([]);
  });

  it("reports the post-answer message too once something was genuinely lost", () => {
    // The report is itself an agent message, so posting it buries everything
    // before it — naming only the lost one would lose the rest.
    const result = analyseAnswer(
      [
        msg("alice", "2026-01-09T23:59:00Z"),
        msg("automata-bot", "2026-01-10T00:05:00Z"),
        msg("alice", "2026-01-10T00:09:00Z"),
      ],
      P,
      MARKER,
      watermark,
    );
    expect(result.missed.map((m) => m.createdAt)).toEqual(["2026-01-09T23:59:00Z"]);
    expect(result.toReport.map((m) => m.createdAt)).toEqual([
      "2026-01-09T23:59:00Z",
      "2026-01-10T00:09:00Z",
    ]);
  });

  it("reports a message posted in the same second as the answer", () => {
    // The boundary rule is strict in the other direction, so a same-second tie
    // is neither reported here nor new next tick — it would vanish. GitHub
    // timestamps are second-resolution, so the tie is reachable.
    const result = analyseAnswer(
      [msg("alice", "2026-01-10T00:05:00Z"), msg("automata-bot", "2026-01-10T00:05:00Z")],
      P,
      MARKER,
      watermark,
    );
    expect(result.missed.map((m) => m.author)).toEqual(["alice"]);
  });

  it("ignores unauthorized accounts entirely", () => {
    const result = analyseAnswer(
      [msg("drive-by", "2026-01-09T23:59:00Z"), msg("automata-bot", "2026-01-10T00:05:00Z")],
      P,
      MARKER,
      watermark,
    );
    expect(result.toReport).toEqual([]);
  });

  it("never treats the agent's own messages as overtaken", () => {
    const result = analyseAnswer(
      [msg("automata-bot", "2026-01-09T23:00:00Z"), msg("automata-bot", "2026-01-10T00:05:00Z")],
      P,
      MARKER,
      watermark,
    );
    expect(result.toReport).toEqual([]);
  });

  it("falls back to the marker when the prompt carried no messages", () => {
    const result = analyseAnswer(
      [msg("alice", "2026-01-10T00:03:00Z"), msg("automata-bot", "2026-01-10T00:05:00Z")],
      P,
      MARKER,
      null,
    );
    expect(result.missed.map((m) => m.createdAt)).toEqual(["2026-01-10T00:03:00Z"]);
  });
});
