import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockRunModel = vi.fn();
vi.mock("../../src/run/secondOpinion.js", () => ({
  runModelOnce: (...a: unknown[]) => mockRunModel(...a),
}));

import {
  buildRecoveryPrompt,
  interpretRecoveryOutput,
  readTranscriptTail,
  recoverAnswer,
  RECOVERY_ANSWER_MAX_CHARS,
  RECOVERY_PROMPT_MAX_BYTES,
} from "../../src/run/answerRecovery.js";

beforeEach(() => {
  mockRunModel.mockReset();
});

describe("buildRecoveryPrompt", () => {
  it("asks for the postable answer itself and carries the transcript and the thread", () => {
    const prompt = buildRecoveryPrompt({ subject: "issue #114", transcript: "T-BODY", conversation: "C-BODY" });
    expect(prompt).toMatch(/never posted a comment/);
    expect(prompt).toMatch(/complete, GitHub-ready answer itself/);
    expect(prompt).toMatch(/Do not explain that no comment was posted/);
    expect(prompt).toMatch(/issue #114/);
    expect(prompt).toMatch(/BEGIN-TRANSCRIPT\nT-BODY\nEND-TRANSCRIPT/);
    expect(prompt).toMatch(/BEGIN-CONVERSATION\nC-BODY\nEND-CONVERSATION/);
  });
});

describe("buildRecoveryPrompt size bound", () => {
  it("keeps the whole prompt under the argument limit, keeping the newest of both inputs", () => {
    const prompt = buildRecoveryPrompt({
      subject: "issue #1",
      transcript: "old-transcript" + "é".repeat(120_000) + "NEW-TRANSCRIPT",
      conversation: "old-conversation" + "x".repeat(96 * 1024) + "NEW-CONVERSATION",
    });
    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(RECOVERY_PROMPT_MAX_BYTES);
    expect(prompt).toContain("NEW-TRANSCRIPT");
    expect(prompt).toContain("NEW-CONVERSATION");
    expect(prompt).not.toContain("old-transcript");
    expect(prompt).not.toContain("old-conversation");
    expect(prompt).not.toContain("\uFFFD");
  });
});

describe("interpretRecoveryOutput", () => {
  it("trims and redacts the answer", () => {
    const result = interpretRecoveryOutput("  Done. ghp_abcdefghijklmnopqrstuvwxyz0123456789\n");
    expect(result.ok).toBe(true);
    expect(result.ok && result.answer).not.toContain("ghp_");
    expect(result.ok && result.answer.startsWith("Done.")).toBe(true);
  });

  it("rejects empty and oversized output", () => {
    expect(interpretRecoveryOutput(" \n")).toEqual({ ok: false, reason: "the model returned an empty answer" });
    expect(interpretRecoveryOutput("x".repeat(RECOVERY_ANSWER_MAX_CHARS + 1)).ok).toBe(false);
  });

  it("rejects an answer within the character cap but over the byte cap", () => {
    expect(interpretRecoveryOutput("漢".repeat(40_000)).ok).toBe(false);
  });

  it("redacts secrets in the transcript before building the prompt", () => {
    const prompt = buildRecoveryPrompt({
      subject: "issue #1",
      transcript: "ok ghp_abcdefghijklmnopqrstuvwxyz0123456789\nabcdef\n-----END PRIVATE KEY-----\nafter",
      conversation: "hi",
    });
    expect(prompt).not.toContain("ghp_");
    expect(prompt).not.toContain("abcdef");
    expect(prompt).toContain("after");
  });
});

describe("readTranscriptTail", () => {
  it("returns the last bytes, null for a missing or blank file", () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-"));
    const file = join(dir, "run.log");
    writeFileSync(file, "0123456789");
    expect(readTranscriptTail(file, 4)).toBe("6789");
    expect(readTranscriptTail(file)).toBe("0123456789");
    writeFileSync(file, "  \n");
    expect(readTranscriptTail(file)).toBeNull();
    expect(readTranscriptTail(join(dir, "missing.log"))).toBeNull();
  });
});

describe("recoverAnswer", () => {
  const input = { subject: "issue #1", transcript: "t", conversation: "c" };

  it("returns the interpreted answer", async () => {
    mockRunModel.mockResolvedValue({ ok: true, stdout: "The answer.\n" });
    expect(await recoverAnswer({ executor: "claude" }, input)).toEqual({ ok: true, answer: "The answer." });
    expect(mockRunModel.mock.calls[0][1]).toMatch(/BEGIN-TRANSCRIPT/);
  });

  it("passes an executor failure through and treats empty output as no answer", async () => {
    mockRunModel.mockResolvedValueOnce({ ok: false, reason: "Claude Code exited with code 1" });
    expect(await recoverAnswer({ executor: "claude" }, input)).toEqual({ ok: false, reason: "Claude Code exited with code 1" });
    mockRunModel.mockResolvedValueOnce({ ok: true, stdout: "" });
    expect((await recoverAnswer({ executor: "claude" }, input)).ok).toBe(false);
  });

  it("turns a rejected executor call into a failed result", async () => {
    mockRunModel.mockRejectedValue(new Error("argv contains a NUL byte"));
    expect(await recoverAnswer({ executor: "claude" }, input)).toEqual({
      ok: false,
      reason: "the recovery pass threw: argv contains a NUL byte",
    });
  });
});
