import { describe, it, expect } from "vitest";
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

function createFakeClaude() {
  const dir = mkdtempSync(join(tmpdir(), "automata-execute-"));
  const promptFile = join(dir, "captured-prompt.txt");
  const claudeBin = join(dir, "claude");

  writeFileSync(
    claudeBin,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const promptIndex = process.argv.indexOf("-p");
if (promptIndex === -1 || promptIndex + 1 >= process.argv.length) {
  process.exit(1);
}

writeFileSync(process.env["AUTOMATA_EXECUTE_PROMPT_FILE"], process.argv[promptIndex + 1]);
`,
  );
  chmodSync(claudeBin, 0o755);

  return {
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env["PATH"] ?? ""}`,
      AUTOMATA_EXECUTE_PROMPT_FILE: promptFile,
    },
    promptFile,
  };
}

function runCli(
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding = {},
): string {
  return execFileSync(process.execPath, ["dist/index.js", ...args], {
    encoding: "utf8",
    ...options,
  });
}

function expectCliFailure(
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding = {},
): void {
  expect(() =>
    runCli(args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    }),
  ).toThrow();
}

function hasHelpEntry(output: string, commandName: string): boolean {
  return output
    .split("\n")
    .map((line) => line.trimStart())
    .some((line) => line === commandName || line.startsWith(`${commandName} `));
}

describe("automata execute (CLI smoke)", () => {
  it("is listed in the top-level help", () => {
    const output = runCli(["--help"]);
    expect(output).toContain("execute");
  });

  it("test command is no longer listed in top-level help", () => {
    const output = runCli(["--help"]);
    expect(hasHelpEntry(output, "test")).toBe(false);
  });

  it("shows help for execute command with all options", () => {
    const output = runCli(["execute", "--help"]);
    expect(output).toContain("--with");
    expect(output).toContain("--prompt");
    expect(output).toContain("--file-prompt");
    expect(output).toContain("--silent");
    expect(output).toContain("--model");
  });

  it("execute --help shows --with as required", () => {
    const output = runCli(["execute", "--help"]);
    expect(output).toContain("--with <executor>");
  });

  it("exits non-zero when --with is missing", () => {
    expectCliFailure(["execute", "--prompt", "hello"]);
  });

  it("exits non-zero with invalid --with value", () => {
    expectCliFailure(["execute", "--with", "invalid", "--prompt", "hello"]);
  });

  it("exits non-zero when no prompt source is provided", () => {
    expectCliFailure(["execute", "--with", "claude"], { input: "" });
  });

  it("exits non-zero when --file-prompt file does not exist", () => {
    expectCliFailure(["execute", "--with", "claude", "--file-prompt", "/nonexistent/prompt.md"]);
  });

  it("exits non-zero when --prompt and --file-prompt are both provided", () => {
    expectCliFailure(["execute", "--with", "claude", "--prompt", "hello", "--file-prompt", "/tmp/foo.md"]);
  });

  it("accepts --prompt even when stdin is a non-interactive pipe", () => {
    const { env, promptFile } = createFakeClaude();

    runCli(["execute", "--with", "claude", "--prompt", "hello from cli"], {
      encoding: "utf8",
      env,
      input: "",
      stdio: ["pipe", "pipe", "pipe"],
    });

    expect(readFileSync(promptFile, "utf8")).toBe("hello from cli");
  });

  it("preserves piped stdin content verbatim", () => {
    const { env, promptFile } = createFakeClaude();
    const prompt = "  keep leading space\n\n```ts\nconst x = 1;\n```\n";

    runCli(["execute", "--with", "claude"], {
      encoding: "utf8",
      env,
      input: prompt,
      stdio: ["pipe", "pipe", "pipe"],
    });

    expect(readFileSync(promptFile, "utf8")).toBe(prompt);
  });

  it("prefers --file-prompt over piped stdin", () => {
    const { env, promptFile } = createFakeClaude();
    const promptDir = mkdtempSync(join(tmpdir(), "automata-file-prompt-"));
    const filePromptPath = join(promptDir, "prompt.md");
    writeFileSync(filePromptPath, "prompt from file\n");

    runCli(["execute", "--with", "claude", "--file-prompt", filePromptPath], {
      encoding: "utf8",
      env,
      input: "ignored stdin",
      stdio: ["pipe", "pipe", "pipe"],
    });

    expect(readFileSync(promptFile, "utf8")).toBe("prompt from file\n");
  });
});
