import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RunTranscript,
  capExcerpt,
  readableLine,
  redactSecrets,
  renderRunDiagnostics,
  transcriptLabel,
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

  it("masks quoted and colon-separated secret assignments whole", () => {
    const out = redactSecrets(`password: "correct horse battery"; api_key='k-1', token=mytoken=x`);
    expect(out).toBe(`password: [redacted]; api_key=[redacted], token=[redacted]`);
  });

  it("masks an unterminated private key to the end of the text", () => {
    const out = redactSecrets("before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nAAAA");
    expect(out).toBe("before\n[redacted]");
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
    expect(Buffer.byteLength(big, "utf8")).toBe(EXCERPT_MAX_BYTES);
    expect(big.startsWith("…")).toBe(true);
  });

  it("stays within the byte cap when the cut lands inside a multi-byte character", () => {
    const out = capExcerpt("é".repeat(5000), 20, 100);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(100);
    expect(out).not.toContain("\uFFFD");
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

  it("keeps the raw transcript private to the user", () => {
    const transcript = new RunTranscript("issue-7", tempRoot());
    expect(statSync(transcript.path).mode & 0o777).toBe(0o600);
  });

  it("keeps an existing .gitignore in the runs directory", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".automata/runs"), { recursive: true });
    writeFileSync(join(root, ".automata/runs/.gitignore"), "*.log\n");
    new RunTranscript("issue-7", root);
    expect(readFileSync(join(root, ".automata/runs/.gitignore"), "utf8")).toBe("*.log\n");
  });

  it("prefixes a stderr line once even when it arrives in several chunks", () => {
    const transcript = new RunTranscript("issue-7", tempRoot());
    transcript.output("stderr", "hel");
    transcript.output("stderr", "lo\nwor");
    transcript.output("stderr", "ld\n");
    expect(readFileSync(transcript.path, "utf8")).toBe("[stderr] hello\n[stderr] world\n");
  });

  it("still yields an excerpt when the directory cannot be created", () => {
    const root = tempRoot();
    // A file where the directory should be makes mkdir fail.
    const blocker = join(root, "blocked");
    writeFileSync(blocker, "");
    const transcript = new RunTranscript("pr-3", join(blocker, "nested"));
    expect(transcript.saved).toBe(false);
    transcript.output("stderr", "oops");
    transcript.exited(2, null);
    expect(transcript.excerpt()).toBe("oops");
  });

  it("redacts a secret before the excerpt is cut, so no half-token survives", () => {
    const transcript = new RunTranscript("issue-7", tempRoot());
    const secret = `ghp_${"a".repeat(40)}`;
    transcript.output("stderr", `${"x".repeat(5000)} ${secret}\n`);
    transcript.exited(1, null);
    expect(transcript.excerpt()).not.toMatch(/a{10}/);
  });

  it("masks a private key whose BEGIN line fell out of the kept tail", () => {
    const transcript = new RunTranscript("issue-7", tempRoot());
    const body = Array.from({ length: 200 }, (_, i) => `KEYMATERIAL${String(i)}`);
    transcript.output("stderr", ["-----BEGIN OPENSSH PRIVATE KEY-----", ...body, ""].join("\n"));
    transcript.output("stderr", "-----END OPENSSH PRIVATE KEY-----\nafter the key\n");
    transcript.exited(1, null);
    const excerpt = transcript.excerpt();
    expect(excerpt).not.toContain("KEYMATERIAL");
    expect(excerpt).toMatch(/after the key$/);
  });
});

describe("transcriptLabel", () => {
  it("names a pull-request turn after the pull request, even when it closes an issue", () => {
    expect(transcriptLabel({ turn: "pr-work", issue: { number: 5 }, pr: { number: 9 } })).toBe("pr-9");
    expect(transcriptLabel({ turn: "pr-orphan", issue: null, pr: { number: 9 } })).toBe("pr-9");
    expect(transcriptLabel({ turn: "issue-discuss", issue: { number: 5 }, pr: null })).toBe("issue-5");
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

  it("replaces the excerpt with the reason when it is withheld", () => {
    const transcript = new RunTranscript("issue-9", tempRoot());
    transcript.output("stderr", "hello\n");
    transcript.exited(0, null);
    const out = renderRunDiagnostics({
      turn: "pr-work",
      subject: "pull request #4",
      transcript,
      effects: null,
      excerpt: { kind: "withheld", reason: "Claude Code exited with code 1" },
    });
    expect(out).toMatch(/withheld, the second redaction pass failed \(Claude Code exited with code 1\)/);
    expect(out).not.toMatch(/<details>|hello/);
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
