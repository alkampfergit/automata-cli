import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, ExecSyncOptions } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const CLI_PATH = join(REPO_ROOT, "dist/index.js");
let testCwd = "";

function automataDir(): string {
  return join(testCwd, ".automata");
}

function run(args: string, opts?: ExecSyncOptions): string {
  return execSync(`node ${JSON.stringify(CLI_PATH)} ${args}`, {
    encoding: "utf8",
    cwd: testCwd,
    ...opts,
  });
}

beforeEach(() => {
  testCwd = mkdtempSync(join(tmpdir(), "automata-config-cmd-"));
});

afterEach(() => {
  rmSync(testCwd, { recursive: true, force: true });
});

describe("automata config set type", () => {
  it("sets remote type to gh and prints confirmation", () => {
    const output = run("config set type gh");
    expect(output.trim()).toBe("Remote type set to: gh");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.remoteType).toBe("gh");
  });

  it("sets remote type to azdo and prints confirmation", () => {
    const output = run("config set type azdo");
    expect(output.trim()).toBe("Remote type set to: azdo");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.remoteType).toBe("azdo");
  });

  it("exits with code 1 and prints error for invalid type", () => {
    let errorOutput = "";
    try {
      run("config set type invalid");
    } catch (err: unknown) {
      const execError = err as { status?: number; stderr?: Buffer };
      expect(execError.status).toBe(1);
      errorOutput = execError.stderr?.toString() ?? "";
    }
    expect(errorOutput).toContain("invalid type");
    expect(existsSync(automataDir())).toBe(false);
  });
});

describe("automata config set issue-discovery-technique", () => {
  it("sets technique to label and prints confirmation", () => {
    const output = run("config set issue-discovery-technique label");
    expect(output.trim()).toBe("Issue discovery technique set to: label");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.issueDiscoveryTechnique).toBe("label");
  });

  it("sets technique to assignee", () => {
    const output = run("config set issue-discovery-technique assignee");
    expect(output.trim()).toBe("Issue discovery technique set to: assignee");
  });

  it("sets technique to title-contains", () => {
    const output = run("config set issue-discovery-technique title-contains");
    expect(output.trim()).toBe("Issue discovery technique set to: title-contains");
  });

  it("exits with code 1 for invalid technique", () => {
    let errorOutput = "";
    try {
      run("config set issue-discovery-technique invalid-mode");
    } catch (err: unknown) {
      const execError = err as { status?: number; stderr?: Buffer };
      expect(execError.status).toBe(1);
      errorOutput = execError.stderr?.toString() ?? "";
    }
    expect(errorOutput).toContain("invalid technique");
  });
});

describe("automata config set issue-discovery-value", () => {
  it("sets issue discovery value and persists it", () => {
    const output = run(`config set issue-discovery-value "ready-for-dev"`);
    expect(output.trim()).toBe("Issue discovery value set to: ready-for-dev");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.issueDiscoveryValue).toBe("ready-for-dev");
  });
});

describe("automata config set claude-system-prompt", () => {
  it("sets claude system prompt and persists it", () => {
    const output = run(`config set claude-system-prompt "You are a senior engineer."`);
    expect(output.trim()).toBe("Claude system prompt set.");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.claudeSystemPrompt).toBe("You are a senior engineer.");
  });
});
