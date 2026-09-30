import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RunTranscript,
  capExcerpt,
  readableLine,
  redactSecrets,
  renderRunDiagnostics,
  EXCERPT_MAX_BYTES,
} from "../../src/run/runTranscript.js";

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "automata-transcript-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("redactSecrets", () => {
  it("masks token-shaped strings", () => {
    const text = [
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "github_pat_11AAAAAAA0abcdefghijklmnopqrstuv",
      "sk-abcdefghijklmnopqrstuvwxyz",
      "Authorization: Bearer abcdefghijklmnop1234",
      "GH_TOKEN=abc123def456",
      "AKIAABCDEFGHIJKLMNOP",
    ].join("\n");
    const out = redactSecrets(text);
    expect(out).not.toMatch(/ghp_|github_pat_|sk-abc|abcdefghijklmnop1234|abc123def456|AKIA/);
    expect(out).toContain("[redacted]");
  });

  it("leaves ordinary text alone", () => {
    expect(redactSecrets("ran 12 tests, all green")).toBe("ran 12 tests, all green");
  });
});

describe("readableLine", () => {
  it("extracts assistant text and tool names, and the final result", () => {
    const assistant = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }, { type: "tool_use", name: "Bash" }] },
    });
    expect(readableLine(assistant)).toBe("hello [tool: Bash]");
    expect(readableLine(JSON.stringify({ type: "result", result: "done" }))).toBe("result: done");
  });

  it("drops events with nothing to show and keeps plain lines", () => {
    expect(readableLine(JSON.stringify({ type: "system" }))).toBeNull();
    expect(readableLine("   ")).toBeNull();
    expect(readableLine("plain error")).toBe("plain error");
  });
});

describe("capExcerpt", () => {
  it("keeps the last lines and caps the size", () => {
    const many = Array.from({ length: 50 }, (_, i) => `line ${String(i)}`).join("\n");
    expect(capExcerpt(many).split("\n")).toHaveLength(20);
    expect(capExcerpt(many)).toMatch(/line 49$/);
    const big = capExcerpt("x".repeat(20000));
    expect(Buffer.byteLength(big, "utf8")).toBeLessThanOrEqual(EXCERPT_MAX_BYTES + 4);
  });
});

describe("RunTranscript", () => {
  it("writes the full output to a file under .automata/runs and ignores it in git", () => {
    const root = tempRoot();
    const transcript = new RunTranscript("issue-7", root, new Date("2026-09-30T13:00:00Z"));
    transcript.output("stdout", '{"type":"result","result":"ok"}\n');
    transcript.output("stderr", "boom\n");
    transcript.exited(1, null);
    expect(transcript.fileName).toBe("2026-09-30T13-00-00-000Z-issue-7.log");
    const written = readFileSync(transcript.path, "utf8");
    expect(written).toContain('"result":"ok"');
    expect(written).toContain("[stderr] boom");
    expect(readFileSync(join(root, ".automata/runs/.gitignore"), "utf8")).toBe("*\n");
    expect(readdirSync(join(root, ".automata/runs"))).toContain(transcript.fileName);
  });

  it("still yields an excerpt when the directory cannot be created", () => {
    const root = tempRoot();
    // A file where the directory should be makes mkdir fail.
    const blocker = join(root, "blocked");
    const transcript = new RunTranscript("pr-3", join(blocker, "nested"));
    transcript.output("stderr", "oops");
    transcript.exited(2, null);
    expect(transcript.excerpt()).toBe("oops");
  });
});

describe("renderRunDiagnostics", () => {
  it("reports exit, duration, effects, the file name and a collapsed excerpt", () => {
    const transcript = new RunTranscript("issue-9", tempRoot());
    transcript.output("stderr", "something failed\n");
    transcript.exited(null, "SIGTERM");
    const out = renderRunDiagnostics({
      turn: "issue-discuss",
      subject: "issue #9",
      transcript,
      effects: {
        branchBefore: "develop",
        branchAfter: "feature/9-x",
        headBefore: "a",
        headAfter: "b",
        pr: { number: 12, url: "https://example.test/pr/12" },
      },
    });
    expect(out).toMatch(/terminated on SIGTERM/);
    expect(out).toMatch(/branch `feature\/9-x` was created or checked out/);
    expect(out).toMatch(/pull request #12 exists/);
    expect(out).toContain(`\`${transcript.fileName}\``);
    expect(out).not.toContain(transcript.path);
    expect(out).toMatch(/<details>[\s\S]*something failed[\s\S]*<\/details>/);
  });

  it("says when nothing changed and when the checkout could not be read", () => {
    const transcript = new RunTranscript("issue-9", tempRoot());
    transcript.exited(0, null);
    const base = { turn: "pr-work", subject: "pull request #4", transcript };
    expect(renderRunDiagnostics({ ...base, effects: null })).toMatch(/could not be determined/);
    const same = { branchBefore: "b", branchAfter: "b", headBefore: "x", headAfter: "x", pr: null };
    expect(renderRunDiagnostics({ ...base, effects: same })).toMatch(/no new branch, pull request or commit/);
  });
});
