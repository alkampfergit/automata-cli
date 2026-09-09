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
