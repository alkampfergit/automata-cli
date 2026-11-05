import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaude, buildClaudeArgs } from "../../src/claude/claudeService.js";
import { runCodex, buildCodexArgs } from "../../src/codex/codexService.js";

// A prompt well over the 128 KiB a single argv entry may hold, and over the
// 64 KiB pipe buffer, so the write cannot finish before the child reads.
const BIG_PROMPT = "x".repeat(256 * 1024) + "\nend";

let dir = "";
let originalPath: string | undefined;

function stub(name: string, body: string): void {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

describe("promptOn", () => {
  it("claude: a bare -p on stdin, the prompt on argv by default", () => {
    expect(buildClaudeArgs("p", { promptOn: "stdin" })).toEqual(["-p"]);
    expect(buildClaudeArgs("p")).toEqual(["-p", "p"]);
  });

  it("codex: an explicit - on stdin, the prompt on argv by default", () => {
    expect(buildCodexArgs("p", { promptOn: "stdin" })).toEqual(["exec", "-"]);
    expect(buildCodexArgs("p")).toEqual(["exec", "p"]);
  });
});

describe("runClaude and runCodex with a real child process", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "automata-stdin-"));
    originalPath = process.env["PATH"];
    process.env["PATH"] = `${dir}:${originalPath ?? ""}`;
  });

  afterAll(() => {
    process.env["PATH"] = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  it("runClaude delivers a 256 KiB prompt without E2BIG", async () => {
    // Reads stdin to EOF into a file, so the whole prompt is compared byte for byte.
    stub("claude", 'cat > "$STUB_OUT"');
    process.env["STUB_OUT"] = join(dir, "claude.out");
    await runClaude(BIG_PROMPT);
    expect(readFileSync(join(dir, "claude.out"), "utf8")).toBe(BIG_PROMPT);
  });

  it("runCodex delivers a 256 KiB prompt without E2BIG", async () => {
    stub("codex", 'cat > "$STUB_OUT"');
    process.env["STUB_OUT"] = join(dir, "codex.out");
    await runCodex(BIG_PROMPT, { quiet: true });
    expect(readFileSync(join(dir, "codex.out"), "utf8")).toBe(BIG_PROMPT);
  });

  it("runClaude reports the exit code, not an unhandled EPIPE, when the child never reads", async () => {
    stub("claude", "exit 3");
    await expect(runClaude(BIG_PROMPT)).rejects.toThrow("Claude Code exited with code 3.");
  });

  it("runCodex reports the exit code, not an unhandled EPIPE, when the child never reads", async () => {
    stub("codex", "exit 4");
    await expect(runCodex(BIG_PROMPT, { quiet: true })).rejects.toThrow("Codex exited with code 4.");
  });
});
