import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, ExecFileSyncOptions } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI_PATH = join(REPO_ROOT, "dist/index.js");
const TEST_TMP_ROOT = join(REPO_ROOT, ".tmp", "config-cmd-tests");
let testCwd = "";

function automataDir(): string {
  return join(testCwd, ".automata");
}

function run(args: string[], opts?: ExecFileSyncOptions): string {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: testCwd,
    ...opts,
  });
}

beforeEach(() => {
  mkdirSync(TEST_TMP_ROOT, { recursive: true });
  testCwd = mkdtempSync(join(TEST_TMP_ROOT, "automata-config-cmd-"));
});

afterEach(() => {
  rmSync(testCwd, { recursive: true, force: true });
});

describe("automata config set type", () => {
  it("sets remote type to gh and prints confirmation", () => {
    const output = run(["config", "set", "type", "gh"]);
    expect(output.trim()).toBe("Remote type set to: gh");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.remoteType).toBe("gh");
  });

  it("sets remote type to azdo and prints confirmation", () => {
    const output = run(["config", "set", "type", "azdo"]);
    expect(output.trim()).toBe("Remote type set to: azdo");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.remoteType).toBe("azdo");
  });

  it("exits with code 1 and prints error for invalid type", () => {
    let errorOutput = "";
    try {
      run(["config", "set", "type", "invalid"]);
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
    const output = run(["config", "set", "issue-discovery-technique", "label"]);
    expect(output.trim()).toBe("Issue discovery technique set to: label");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.issueDiscoveryTechnique).toBe("label");
  });

  it("sets technique to assignee", () => {
    const output = run(["config", "set", "issue-discovery-technique", "assignee"]);
    expect(output.trim()).toBe("Issue discovery technique set to: assignee");
  });

  it("sets technique to title-contains", () => {
    const output = run(["config", "set", "issue-discovery-technique", "title-contains"]);
    expect(output.trim()).toBe("Issue discovery technique set to: title-contains");
  });

  it("exits with code 1 for invalid technique", () => {
    let errorOutput = "";
    try {
      run(["config", "set", "issue-discovery-technique", "invalid-mode"]);
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
    const output = run(["config", "set", "issue-discovery-value", "ready-for-dev"]);
    expect(output.trim()).toBe("Issue discovery value set to: ready-for-dev");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.issueDiscoveryValue).toBe("ready-for-dev");
  });
});

describe("automata config set claude-system-prompt", () => {
  it("sets claude system prompt and persists it", () => {
    const output = run(["config", "set", "claude-system-prompt", "You are a senior engineer."]);
    expect(output.trim()).toBe("Claude system prompt set.");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.claudeSystemPrompt).toBe("You are a senior engineer.");
  });
});

describe("automata config set allowed-users", () => {
  it("stores a comma-separated list of logins", () => {
    const output = run(["config", "set", "allowed-users", "alice,bob"]);
    expect(output.trim()).toBe("Allowed users set to: alice, bob");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.allowedUsers).toEqual(["alice", "bob"]);
  });

  it("trims whitespace and drops empty entries", () => {
    run(["config", "set", "allowed-users", " alice , , bob ,"]);
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.allowedUsers).toEqual(["alice", "bob"]);
  });

  it("exits with code 1 when no login is given", () => {
    let errorOutput = "";
    try {
      run(["config", "set", "allowed-users", " , "]);
    } catch (err: unknown) {
      const execError = err as { status?: number; stderr?: Buffer };
      expect(execError.status).toBe(1);
      errorOutput = execError.stderr?.toString() ?? "";
    }
    expect(errorOutput).toContain("at least one login");
    expect(existsSync(automataDir())).toBe(false);
  });

  it("preserves existing configuration values", () => {
    run(["config", "set", "type", "gh"]);
    run(["config", "set", "allowed-users", "alice"]);
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.remoteType).toBe("gh");
    expect(config.allowedUsers).toEqual(["alice"]);
  });
});

describe("automata config set agent-user", () => {
  it("stores the agent login and prints confirmation", () => {
    const output = run(["config", "set", "agent-user", "agent-bot"]);
    expect(output.trim()).toBe("Agent user set to: agent-bot");
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.agentUser).toBe("agent-bot");
  });

  it("trims surrounding whitespace", () => {
    run(["config", "set", "agent-user", "  agent-bot  "]);
    const config = JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8"));
    expect(config.agentUser).toBe("agent-bot");
  });

  it("exits with code 1 for an empty login", () => {
    let errorOutput = "";
    try {
      run(["config", "set", "agent-user", "   "]);
    } catch (err: unknown) {
      const execError = err as { status?: number; stderr?: Buffer };
      expect(execError.status).toBe(1);
      errorOutput = execError.stderr?.toString() ?? "";
    }
    expect(errorOutput).toContain("non-empty login");
    expect(existsSync(automataDir())).toBe(false);
  });
});

function readConfigFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(automataDir(), "config.json"), "utf8")) as Record<string, unknown>;
}

function runExpectingFailure(args: string[]): string {
  let errorOutput = "";
  try {
    run(args);
    throw new Error("expected the command to fail");
  } catch (err) {
    const execError = err as { status?: number; stderr?: Buffer };
    expect(execError.status).toBe(1);
    errorOutput = execError.stderr?.toString() ?? "";
  }
  return errorOutput;
}

describe("automata config set do-work-*", () => {
  it("sets the base branch", () => {
    const output = run(["config", "set", "do-work-base-branch", "main"]);
    expect(output.trim()).toBe("do-work base branch set to: main");
    expect(readConfigFile().doWork).toEqual({ baseBranch: "main" });
  });

  it("rejects an empty base branch", () => {
    expect(runExpectingFailure(["config", "set", "do-work-base-branch", "  "])).toMatch(/non-empty branch name/);
  });

  it("sets the protected branches", () => {
    const output = run(["config", "set", "do-work-protected-branches", "main, release"]);
    expect(output.trim()).toBe("do-work protected branches set to: main, release");
    expect(readConfigFile().doWork).toEqual({ protectedBranches: ["main", "release"] });
  });

  it("rejects an empty protected branch list", () => {
    expect(runExpectingFailure(["config", "set", "do-work-protected-branches", " , "])).toMatch(
      /at least one branch name/,
    );
  });

  it("sets the executor", () => {
    run(["config", "set", "do-work-executor", "codex"]);
    expect(readConfigFile().doWork).toEqual({ executor: "codex" });
  });

  it("rejects an unknown executor", () => {
    const errorOutput = runExpectingFailure(["config", "set", "do-work-executor", "gemini"]);
    expect(errorOutput).toMatch(/invalid executor "gemini"/);
    expect(errorOutput).toMatch(/claude, codex/);
  });

  it("sets a per-executor model", () => {
    const output = run(["config", "set", "do-work-model", "codex", "o3"]);
    expect(output.trim()).toBe("do-work codex model set to: o3");
    expect(readConfigFile().doWork).toEqual({ models: { codex: "o3" } });
  });

  it("keeps each executor's model separate", () => {
    run(["config", "set", "do-work-model", "claude", "claude-opus-4-6"]);
    run(["config", "set", "do-work-model", "codex", "o3"]);
    expect(readConfigFile().doWork).toEqual({
      models: { claude: "claude-opus-4-6", codex: "o3" },
    });
  });

  it("rejects an unknown executor for the model", () => {
    const errorOutput = runExpectingFailure(["config", "set", "do-work-model", "gemini", "x"]);
    expect(errorOutput).toMatch(/invalid executor "gemini"/);
  });

  it("rejects an empty model", () => {
    expect(runExpectingFailure(["config", "set", "do-work-model", "claude", "  "])).toMatch(
      /non-empty model identifier/,
    );
  });

  it("sets the default effort for one executor", () => {
    const output = run(["config", "set", "do-work-effort", "claude", "high"]);
    expect(output.trim()).toBe("do-work claude effort set to: high");
    expect(readConfigFile().doWork).toEqual({ effort: { claude: "high" } });
  });

  it("keeps each executor's effort separate", () => {
    run(["config", "set", "do-work-effort", "claude", "high"]);
    run(["config", "set", "do-work-effort", "codex", "medium"]);
    expect(readConfigFile().doWork).toEqual({
      effort: { claude: "high", codex: "medium" },
    });
  });

  it("leaves the configured models alone when setting the effort", () => {
    run(["config", "set", "do-work-model", "claude", "claude-opus-5"]);
    run(["config", "set", "do-work-effort", "claude", "high"]);
    expect(readConfigFile().doWork).toEqual({
      models: { claude: "claude-opus-5" },
      effort: { claude: "high" },
    });
  });

  it("accepts a level automata does not know, because the valid set is the executor's", () => {
    // Deliberately not allow-listed: the valid set is model-specific and moves
    // between executor releases.
    run(["config", "set", "do-work-effort", "codex", "ultra"]);
    expect(readConfigFile().doWork).toEqual({ effort: { codex: "ultra" } });
  });

  it("rejects an unknown executor for the effort", () => {
    expect(runExpectingFailure(["config", "set", "do-work-effort", "gemini", "high"])).toMatch(
      /invalid executor "gemini"/,
    );
  });

  it("rejects an empty effort", () => {
    expect(runExpectingFailure(["config", "set", "do-work-effort", "claude", "  "])).toMatch(
      /non-empty effort level/,
    );
  });

  it("sets the per-tick run cap", () => {
    const output = run(["config", "set", "do-work-max-runs", "3"]);
    expect(output.trim()).toBe("do-work max runs per tick set to: 3");
    expect(readConfigFile().doWork).toEqual({ maxRunsPerTick: 3 });
  });

  it("accepts zero as unlimited for the run cap", () => {
    const output = run(["config", "set", "do-work-max-runs", "0"]);
    expect(output.trim()).toBe("do-work max runs per tick set to: 0 (unlimited)");
    expect(readConfigFile().doWork).toEqual({ maxRunsPerTick: 0 });
  });

  it("rejects a non-numeric run cap", () => {
    expect(runExpectingFailure(["config", "set", "do-work-max-runs", "many"])).toMatch(
      /do-work-max-runs must be a non-negative integer/,
    );
  });

  it("rejects a negative run cap", () => {
    expect(runExpectingFailure(["config", "set", "do-work-max-runs", "-1"])).toMatch(
      /non-negative integer/,
    );
  });

  it("sets the lock staleness window", () => {
    run(["config", "set", "do-work-lock-stale-minutes", "45"]);
    expect(readConfigFile().doWork).toEqual({ lockStaleMinutes: 45 });
  });

  it("rejects a zero lock staleness window", () => {
    expect(runExpectingFailure(["config", "set", "do-work-lock-stale-minutes", "0"])).toMatch(
      /must be greater than zero/,
    );
  });

  it("sets the issue-discuss prompt", () => {
    const output = run(["config", "set", "do-work-prompt", "issue-discuss", "discuss.md"]);
    expect(output.trim()).toBe("do-work issue-discuss prompt set.");
    expect(readConfigFile().doWork).toEqual({ prompts: { issueDiscuss: "discuss.md" } });
  });

  it("sets the pr-work prompt", () => {
    run(["config", "set", "do-work-prompt", "pr-work", "Fix the comments"]);
    expect(readConfigFile().doWork).toEqual({ prompts: { prWork: "Fix the comments" } });
  });

  it("sets the pr-orphan prompt", () => {
    const output = run(["config", "set", "do-work-prompt", "pr-orphan", "orphan.md"]);
    expect(output.trim()).toBe("do-work pr-orphan prompt set.");
    expect(readConfigFile().doWork).toEqual({ prompts: { prOrphan: "orphan.md" } });
  });

  it("rejects an unknown turn kind", () => {
    const errorOutput = runExpectingFailure(["config", "set", "do-work-prompt", "implement", "x.md"]);
    expect(errorOutput).toMatch(/invalid turn kind "implement"/);
    expect(errorOutput).toMatch(/issue-discuss, pr-work, pr-orphan/);
  });

  it("rejects an empty prompt", () => {
    expect(runExpectingFailure(["config", "set", "do-work-prompt", "pr-work", "  "])).toMatch(
      /requires a non-empty value/,
    );
  });

  it("merges do-work fields instead of replacing the section", () => {
    run(["config", "set", "do-work-base-branch", "main"]);
    run(["config", "set", "do-work-executor", "codex"]);
    run(["config", "set", "do-work-model", "codex", "o3"]);
    run(["config", "set", "do-work-prompt", "issue-discuss", "discuss.md"]);
    run(["config", "set", "do-work-prompt", "pr-work", "pr.md"]);
    run(["config", "set", "do-work-prompt", "pr-orphan", "orphan.md"]);
    expect(readConfigFile().doWork).toEqual({
      baseBranch: "main",
      executor: "codex",
      models: { codex: "o3" },
      prompts: { issueDiscuss: "discuss.md", prWork: "pr.md", prOrphan: "orphan.md" },
    });
  });

  it("leaves unrelated configuration untouched", () => {
    run(["config", "set", "type", "gh"]);
    run(["config", "set", "do-work-base-branch", "main"]);
    const config = readConfigFile();
    expect(config.remoteType).toBe("gh");
    expect(config.doWork).toEqual({ baseBranch: "main" });
  });
});
