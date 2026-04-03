import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
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

describe("automata execute (CLI smoke)", () => {
  it("is listed in the top-level help", () => {
    const output = execSync(`"${process.execPath}" dist/index.js --help`, { encoding: "utf8" });
    expect(output).toContain("execute");
  });

  it("test command is no longer listed in top-level help", () => {
    const output = execSync(`"${process.execPath}" dist/index.js --help`, { encoding: "utf8" });
    expect(output).not.toMatch(/^\s*test\b/m);
  });

  it("shows help for execute command with all options", () => {
    const output = execSync(`"${process.execPath}" dist/index.js execute --help`, { encoding: "utf8" });
    expect(output).toContain("--with");
    expect(output).toContain("--prompt");
    expect(output).toContain("--file-prompt");
    expect(output).toContain("--silent");
    expect(output).toContain("--model");
  });

  it("execute --help shows --with as required", () => {
    const output = execSync(`"${process.execPath}" dist/index.js execute --help`, { encoding: "utf8" });
    expect(output).toContain("--with <executor>");
  });

  it("exits non-zero when --with is missing", () => {
    let threw = false;
    try {
      execSync(`"${process.execPath}" dist/index.js execute --prompt "hello"`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("exits non-zero with invalid --with value", () => {
    let threw = false;
    try {
      execSync(`"${process.execPath}" dist/index.js execute --with invalid --prompt "hello"`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("exits non-zero when no prompt source is provided", () => {
    let threw = false;
    try {
      execSync(`"${process.execPath}" dist/index.js execute --with claude`, {
        encoding: "utf8",
        input: "",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("exits non-zero when --file-prompt file does not exist", () => {
    let threw = false;
    try {
      execSync(
        `"${process.execPath}" dist/index.js execute --with claude --file-prompt /nonexistent/prompt.md`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("exits non-zero when --prompt and --file-prompt are both provided", () => {
    let threw = false;
    try {
      execSync(
        `"${process.execPath}" dist/index.js execute --with claude --prompt "hello" --file-prompt /tmp/foo.md`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("accepts --prompt even when stdin is a non-interactive pipe", () => {
    const { env, promptFile } = createFakeClaude();

    execSync(`"${process.execPath}" dist/index.js execute --with claude --prompt "hello from cli"`, {
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

    execSync(`"${process.execPath}" dist/index.js execute --with claude`, {
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

    execSync(`"${process.execPath}" dist/index.js execute --with claude --file-prompt "${filePromptPath}"`, {
      encoding: "utf8",
      env,
      input: "ignored stdin",
      stdio: ["pipe", "pipe", "pipe"],
    });

    expect(readFileSync(promptFile, "utf8")).toBe("prompt from file\n");
  });
});
