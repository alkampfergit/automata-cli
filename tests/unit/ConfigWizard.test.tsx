import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { ConfigWizard } from "../../src/config/ConfigWizard.js";

vi.mock("../../src/config/configStore.js", () => ({
  readConfig: vi.fn(() => ({})),
  writeConfig: vi.fn(),
  DEFAULT_SONAR_PROMPT: "default sonar prompt",
  DEFAULT_FIX_COMMENTS_PROMPT: "default fix-comments prompt",
}));

const ENTER = "\r";
const ESC = "\x1B";
const DOWN = "\x1B[B";

// Screen-identifying strings
const PROMPTS_MENU_HINT = "Esc to go back";
const SONAR_SCREEN_TEXT = "Sonar prompt:";
const FIX_COMMENTS_SCREEN_TEXT = "Fix-Comments prompt:";

async function tick(ms = 50) {
  await new Promise((r) => setTimeout(r, ms));
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
