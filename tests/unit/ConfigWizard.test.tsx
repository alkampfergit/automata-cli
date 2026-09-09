import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { ConfigWizard } from "../../src/config/ConfigWizard.js";

vi.mock("../../src/config/configStore.js", () => ({
  readConfig: vi.fn(() => ({})),
  readRawConfig: vi.fn(() => ({})),
  writeConfig: vi.fn(),
  DEFAULT_SONAR_PROMPT: "default sonar prompt",
  DEFAULT_FIX_COMMENTS_PROMPT: "default fix-comments prompt",
  DEFAULT_CHECK_ISSUE_PROMPT: "default check-issue prompt",
  DEFAULT_DO_WORK: { baseBranch: "develop", executor: "claude", maxRunsPerTick: 0, lockStaleMinutes: 120 },
  DEFAULT_DO_WORK_ISSUE_DISCUSS_PROMPT: "default do-work discuss prompt",
  DEFAULT_DO_WORK_PR_WORK_PROMPT: "default do-work pr prompt",
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(), mkdirSync: vi.fn() };
});

const ENTER = "\r";
const ESC = "\x1B";
const DOWN = "\x1B[B";

// Screen-identifying strings
const PROMPTS_MENU_HINT = "Esc to go back";
const SONAR_SCREEN_TEXT = "Sonar prompt:";
const FIX_COMMENTS_SCREEN_TEXT = "Fix-Comments prompt:";
const CHECK_ISSUE_SCREEN_TEXT = "Check-Issue prompt:";
const ALLOWED_USERS_SCREEN_TEXT = "Logins allowed to instruct the agent";
const AGENT_USER_SCREEN_TEXT = "Login the agent posts as:";
const DO_WORK_BASE_BRANCH_SCREEN_TEXT = "Branch discussion turns return to:";
const DO_WORK_EXECUTOR_SCREEN_TEXT = "Do Work — Executor";
const DO_WORK_MAX_RUNS_SCREEN_TEXT = "Model runs allowed per tick";
const DO_WORK_LOCK_STALE_SCREEN_TEXT = "Minutes before a run lock";
const DO_WORK_CLAUDE_MODEL_SCREEN_TEXT = "Default model when the executor is Claude";
const DO_WORK_CODEX_MODEL_SCREEN_TEXT = "Default model when the executor is Codex";
const DO_WORK_DISCUSS_SCREEN_TEXT = "Discussion turn instructions:";
const DO_WORK_PR_SCREEN_TEXT = "Pull request turn instructions:";

async function tick() {
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

async function navigateToPromptsMenu(stdin: { write: (s: string) => void }) {
  // Main menu: Remote/Mode(0), Implement-Next(1), Prompts(2)
  stdin.write(DOWN);
  stdin.write(DOWN);
  await tick();
  stdin.write(ENTER);
  await tick();
}

async function navigateToSonarPrompt(stdin: { write: (s: string) => void }) {
  await navigateToPromptsMenu(stdin);
  // Sonar is index 0 in prompts-menu — just press Enter
  stdin.write(ENTER);
  await tick();
}

async function navigateToCheckIssuePrompt(stdin: { write: (s: string) => void }) {
  await navigateToPromptsMenu(stdin);
  // Check-Issue is index 2 — press DOWN twice then Enter
  stdin.write(DOWN);
  stdin.write(DOWN);
  await tick();
  stdin.write(ENTER);
  await tick();
}

async function navigateToIssueWatch(stdin: { write: (s: string) => void }) {
  // Main menu: Remote/Mode(0), Implement-Next(1), Prompts(2), Issue Watch(3)
  stdin.write(DOWN);
  stdin.write(DOWN);
  stdin.write(DOWN);
  await tick();
  stdin.write(ENTER);
  await tick();
}

async function navigateToFixCommentsPrompt(stdin: { write: (s: string) => void }) {
  await navigateToPromptsMenu(stdin);
  // Fix-Comments is index 1 — press DOWN then Enter
  stdin.write(DOWN);
  await tick();
  stdin.write(ENTER);
  await tick();
}

// ── Sonar prompt navigation ───────────────────────────────────────────────────

describe("ConfigWizard — sonar prompt navigation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns to prompts-menu after saving sonar prompt with Enter", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToSonarPrompt(stdin);
    expect(lastFrame()).toContain(SONAR_SCREEN_TEXT);

    stdin.write(ENTER);
    await tick();

    expect(lastFrame()).toContain(PROMPTS_MENU_HINT);
    expect(lastFrame()).not.toContain(SONAR_SCREEN_TEXT);
  });

  it("does not exit the wizard after saving sonar prompt", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToSonarPrompt(stdin);
    stdin.write(ENTER);
    await tick();

    expect(lastFrame()).toContain(PROMPTS_MENU_HINT);
  });

  it("still saves config when Enter is pressed on sonar-prompt", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    const { stdin } = render(<ConfigWizard />);

    await navigateToSonarPrompt(stdin);
    stdin.write(ENTER);
    await tick();

    expect(writeConfig).toHaveBeenCalled();
  });
});

// ── Prompts menu — Fix-Comments item ─────────────────────────────────────────

describe("ConfigWizard — prompts-menu with Fix-Comments", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows Fix-Comments as an option in the prompts-menu", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToPromptsMenu(stdin);

    expect(lastFrame()).toContain("Fix-Comments");
  });

  it("navigates to Fix-Comments screen when selected", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToFixCommentsPrompt(stdin);

    expect(lastFrame()).toContain(FIX_COMMENTS_SCREEN_TEXT);
  });

  it("returns to prompts-menu after saving fix-comments prompt with Enter", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToFixCommentsPrompt(stdin);
    expect(lastFrame()).toContain(FIX_COMMENTS_SCREEN_TEXT);

    stdin.write(ENTER);
    await tick();

    expect(lastFrame()).toContain(PROMPTS_MENU_HINT);
    expect(lastFrame()).not.toContain(FIX_COMMENTS_SCREEN_TEXT);
  });

  it("saves config when Enter is pressed on fix-comments-prompt", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    const { stdin } = render(<ConfigWizard />);

    await navigateToFixCommentsPrompt(stdin);
    stdin.write(ENTER);
    await tick();

    expect(writeConfig).toHaveBeenCalled();
  });

  it("Esc on fix-comments-prompt returns to prompts-menu", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToFixCommentsPrompt(stdin);
    stdin.write(ESC);
    await tick();

    expect(lastFrame()).toContain(PROMPTS_MENU_HINT);
    expect(lastFrame()).not.toContain(FIX_COMMENTS_SCREEN_TEXT);
  });
});

// ── Prompts menu — Check-Issue item ──────────────────────────────────────────

describe("ConfigWizard — prompts-menu with Check-Issue", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows Check-Issue as an option in the prompts-menu", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToPromptsMenu(stdin);

    expect(lastFrame()).toContain("Check-Issue");
  });

  it("navigates to the Check-Issue screen when selected", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToCheckIssuePrompt(stdin);

    expect(lastFrame()).toContain(CHECK_ISSUE_SCREEN_TEXT);
  });

  it("writes the prompt file and stores its filename on Enter", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    const { writeFileSync } = await import("node:fs");
    const { stdin } = render(<ConfigWizard />);

    await navigateToCheckIssuePrompt(stdin);
    stdin.write(ENTER);
    await tick();

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("check-issue-prompt.md"),
      "default check-issue prompt",
      "utf8",
    );
    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ prompts: expect.objectContaining({ checkIssue: "check-issue-prompt.md" }) }),
    );
  });

  it("returns to prompts-menu after saving the Check-Issue prompt", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToCheckIssuePrompt(stdin);
    stdin.write(ENTER);
    await tick();

    expect(lastFrame()).toContain(PROMPTS_MENU_HINT);
    expect(lastFrame()).not.toContain(CHECK_ISSUE_SCREEN_TEXT);
  });

  it("Esc on the Check-Issue screen returns to prompts-menu", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToCheckIssuePrompt(stdin);
    stdin.write(ESC);
    await tick();

    expect(lastFrame()).toContain(PROMPTS_MENU_HINT);
    expect(lastFrame()).not.toContain(CHECK_ISSUE_SCREEN_TEXT);
  });
});

// ── Issue Watch screens ──────────────────────────────────────────────────────

describe("ConfigWizard — Issue Watch", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows Issue Watch in the main menu", () => {
    const { lastFrame } = render(<ConfigWizard />);

    expect(lastFrame()).toContain("Issue Watch");
  });

  it("opens the allowed-users screen from the main menu", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToIssueWatch(stdin);

    expect(lastFrame()).toContain(ALLOWED_USERS_SCREEN_TEXT);
  });

  it("continues to the agent-user screen on Enter", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToIssueWatch(stdin);
    stdin.write(ENTER);
    await tick();

    expect(lastFrame()).toContain(AGENT_USER_SCREEN_TEXT);
  });

  it("saves the typed allowed users and agent user", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    const { stdin } = render(<ConfigWizard />);

    await navigateToIssueWatch(stdin);
    stdin.write("alice, bob");
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write("agent-bot");
    await tick();
    stdin.write(ENTER);
    await tick();

    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ allowedUsers: ["alice", "bob"], agentUser: "agent-bot" }),
    );
  });

  it("stores undefined instead of empty values when nothing is typed", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    const { stdin } = render(<ConfigWizard />);

    await navigateToIssueWatch(stdin);
    stdin.write(ENTER);
    await tick();
    stdin.write(ENTER);
    await tick();

    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ allowedUsers: undefined, agentUser: undefined }),
    );
  });

  it("Esc on the agent-user screen returns to the allowed-users screen", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToIssueWatch(stdin);
    stdin.write(ENTER);
    await tick();
    stdin.write(ESC);
    await tick();

    expect(lastFrame()).toContain(ALLOWED_USERS_SCREEN_TEXT);
  });

  it("Esc on the allowed-users screen returns to the main menu", async () => {
    const { lastFrame, stdin } = render(<ConfigWizard />);

    await navigateToIssueWatch(stdin);
    stdin.write(ESC);
    await tick();

    expect(lastFrame()).toContain("Configure Automata");
  });
});

async function navigateToDoWork(stdin: { write: (s: string) => void }) {
  // Main menu: Remote/Mode(0), Implement-Next(1), Prompts(2), Issue Watch(3), Do Work(4)
  for (let i = 0; i < 4; i += 1) stdin.write(DOWN);
  await tick();
  stdin.write(ENTER);
  await tick();
}

async function navigateToPromptsEntry(stdin: { write: (s: string) => void }, downs: number) {
  await navigateToPromptsMenu(stdin);
  for (let i = 0; i < downs; i += 1) stdin.write(DOWN);
  await tick();
  stdin.write(ENTER);
  await tick();
}

describe("ConfigWizard — list screen back navigation", () => {
  it("goes back to the main menu from the remote screen", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    stdin.write(ENTER);
    await tick();
    stdin.write(ESC);
    await tick();
    expect(lastFrame()).toContain("Configure Automata");
  });

  it("goes back to the main menu from the technique screen", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    stdin.write(DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write(ESC);
    await tick();
    expect(lastFrame()).toContain("Configure Automata");
  });

  it("goes back to the main menu from the prompts menu", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToPromptsMenu(stdin);
    stdin.write(ESC);
    await tick();
    expect(lastFrame()).toContain("Configure Automata");
  });

  it("goes back from the executor screen to the base branch screen", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    stdin.write(ENTER);
    await tick();
    stdin.write(ESC);
    await tick();
    expect(lastFrame()).toContain(DO_WORK_BASE_BRANCH_SCREEN_TEXT);
  });
});

describe("ConfigWizard — Do Work section", () => {
  it("reaches the base branch screen prefilled with the default", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    expect(lastFrame()).toContain(DO_WORK_BASE_BRANCH_SCREEN_TEXT);
    expect(lastFrame()).toContain("develop");
  });

  it("walks base branch, executor, both models, run cap and lock staleness, then saves", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    const { stdin } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);

    // Base branch: clear "develop" then type "main".
    for (let i = 0; i < "develop".length; i += 1) stdin.write("\x7f");
    stdin.write("main");
    await tick();
    stdin.write(ENTER);
    await tick();

    // Executor: pick Codex.
    stdin.write(DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();

    // Claude model, then Codex model.
    stdin.write("claude-opus-4-6");
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write("o3");
    await tick();
    stdin.write(ENTER);
    await tick();

    // Run cap: clear "0" then type "2".
    stdin.write("\x7f");
    stdin.write("2");
    await tick();
    stdin.write(ENTER);
    await tick();

    // Lock staleness: clear "120" then type "45".
    for (let i = 0; i < "120".length; i += 1) stdin.write("\x7f");
    stdin.write("45");
    await tick();
    stdin.write(ENTER);
    await tick();

    expect(writeConfig).toHaveBeenCalledWith({
      doWork: {
        baseBranch: "main",
        executor: "codex",
        models: { claude: "claude-opus-4-6", codex: "o3" },
        maxRunsPerTick: 2,
        lockStaleMinutes: 45,
      },
    });
  });

  it("reaches the lock staleness screen after the run cap", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    for (let i = 0; i < 5; i += 1) {
      stdin.write(ENTER);
      await tick();
    }
    expect(lastFrame()).toContain(DO_WORK_LOCK_STALE_SCREEN_TEXT);
  });

  it("keeps the operator on the run cap screen when the value is malformed", async () => {
    // An omitted cap means unlimited, so accepting "2abc" would silently remove
    // the operator'"'"'s spend limit on a typo.
    const { writeConfig } = await import("../../src/config/configStore.js");
    const writesBefore = vi.mocked(writeConfig).mock.calls.length;
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    // base branch -> executor -> claude model -> codex model -> run cap
    for (let i = 0; i < 4; i += 1) {
      stdin.write(ENTER);
      await tick();
    }
    stdin.write("abc");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).toContain(DO_WORK_MAX_RUNS_SCREEN_TEXT);
    expect(lastFrame()).toContain("non-negative whole number");
    // Nothing persisted: an omitted cap would have meant unlimited.
    expect(vi.mocked(writeConfig).mock.calls.length).toBe(writesBefore);
  });

  it("rejects a non-positive lock staleness in place", async () => {
    const { writeConfig } = await import("../../src/config/configStore.js");
    const writesBefore = vi.mocked(writeConfig).mock.calls.length;
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    // ...through the run cap to the lock staleness screen
    for (let i = 0; i < 5; i += 1) {
      stdin.write(ENTER);
      await tick();
    }
    for (let i = 0; i < "120".length; i += 1) stdin.write("\x7f");
    stdin.write("0");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).toContain(DO_WORK_LOCK_STALE_SCREEN_TEXT);
    expect(lastFrame()).toContain("greater than zero");
    expect(vi.mocked(writeConfig).mock.calls.length).toBe(writesBefore);
  });

  it("shows the executor options", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).toContain(DO_WORK_EXECUTOR_SCREEN_TEXT);
    expect(lastFrame()).toContain("Claude Code");
    expect(lastFrame()).toContain("Codex");
  });

  it("goes back from the executor screen to the base branch screen", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    stdin.write(ENTER);
    await tick();
    stdin.write(ESC);
    await tick();
    expect(lastFrame()).toContain(DO_WORK_BASE_BRANCH_SCREEN_TEXT);
  });

  it("reaches the Claude model screen after the executor screen", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    stdin.write(ENTER);
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).toContain(DO_WORK_CLAUDE_MODEL_SCREEN_TEXT);
  });

  it("reaches the Codex model screen after the Claude one", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    for (let i = 0; i < 3; i += 1) {
      stdin.write(ENTER);
      await tick();
    }
    expect(lastFrame()).toContain(DO_WORK_CODEX_MODEL_SCREEN_TEXT);
  });

  it("goes back from the run cap screen to the Codex model screen", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    for (let i = 0; i < 4; i += 1) {
      stdin.write(ENTER);
      await tick();
    }
    stdin.write(ESC);
    await tick();
    expect(lastFrame()).toContain(DO_WORK_CODEX_MODEL_SCREEN_TEXT);
  });

  it("goes back from the Codex model screen to the Claude one", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    for (let i = 0; i < 3; i += 1) {
      stdin.write(ENTER);
      await tick();
    }
    stdin.write(ESC);
    await tick();
    expect(lastFrame()).toContain(DO_WORK_CLAUDE_MODEL_SCREEN_TEXT);
  });

  it("reaches the run cap screen prefilled with the default", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToDoWork(stdin);
    for (let i = 0; i < 4; i += 1) {
      stdin.write(ENTER);
      await tick();
    }
    expect(lastFrame()).toContain(DO_WORK_MAX_RUNS_SCREEN_TEXT);
  });
});

describe("ConfigWizard — Do Work prompts", () => {
  it("reaches the discuss prompt screen prefilled with the default", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToPromptsEntry(stdin, 3);
    expect(lastFrame()).toContain(DO_WORK_DISCUSS_SCREEN_TEXT);
    expect(lastFrame()).toContain("default do-work discuss prompt");
  });

  it("writes the discuss prompt file and stores the filename", async () => {
    const { writeFileSync } = await import("node:fs");
    const { writeConfig } = await import("../../src/config/configStore.js");
    const { stdin } = render(<ConfigWizard />);
    await navigateToPromptsEntry(stdin, 3);
    stdin.write(ENTER);
    await tick();
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("do-work-issue-discuss.md"),
      "default do-work discuss prompt",
      "utf8",
    );
    expect(writeConfig).toHaveBeenCalledWith({
      doWork: { prompts: { issueDiscuss: "do-work-issue-discuss.md" } },
    });
  });

  it("reaches the pull request prompt screen prefilled with the default", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToPromptsEntry(stdin, 4);
    expect(lastFrame()).toContain(DO_WORK_PR_SCREEN_TEXT);
    expect(lastFrame()).toContain("default do-work pr prompt");
  });

  it("writes the pull request prompt file and stores the filename", async () => {
    const { writeFileSync } = await import("node:fs");
    const { writeConfig } = await import("../../src/config/configStore.js");
    const { stdin } = render(<ConfigWizard />);
    await navigateToPromptsEntry(stdin, 4);
    stdin.write(ENTER);
    await tick();
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("do-work-pr-work.md"),
      "default do-work pr prompt",
      "utf8",
    );
    expect(writeConfig).toHaveBeenCalledWith({
      doWork: { prompts: { prWork: "do-work-pr-work.md" } },
    });
  });

  it("returns to the prompts menu after saving a do-work prompt", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToPromptsEntry(stdin, 3);
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).toContain("Do Work — Discuss");
    expect(lastFrame()).toContain(PROMPTS_MENU_HINT);
  });

  it("leaves the existing prompt entries reachable at their original positions", async () => {
    const { stdin, lastFrame } = render(<ConfigWizard />);
    await navigateToPromptsEntry(stdin, 0);
    expect(lastFrame()).toContain(SONAR_SCREEN_TEXT);
  });
});
