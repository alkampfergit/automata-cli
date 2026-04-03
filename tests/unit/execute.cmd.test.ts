import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("automata execute (CLI smoke)", () => {
  it("is listed in the top-level help", () => {
    const output = execSync(`"${process.execPath}" dist/index.js --help`, { encoding: "utf8" });
    expect(output).toContain("execute");
  });

  it("test command is no longer listed in top-level help", () => {
    const output = execSync(`"${process.execPath}" dist/index.js --help`, { encoding: "utf8" });
    expect(output).not.toContain("Test commands for verifying automata integrations");
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
});
